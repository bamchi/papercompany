#!/usr/bin/env node

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, statSync } from "fs";
import { execSync } from "child_process";
import { createInterface } from "readline";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATES_DIR = resolve(__dirname, "..", "templates");

const args = process.argv.slice(2);
const command = args[0] || "help";

// ─── Helpers ───

let _rl = null;
function getRl() {
  if (!_rl) {
    _rl = createInterface({ input: process.stdin, output: process.stdout });
    _rl.on("close", () => { _rl = null; });
  }
  return _rl;
}

function ask(question) {
  const rl = getRl();
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

function closeRl() {
  if (_rl) { _rl.close(); _rl = null; }
}

function copyDir(src, dest) {
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = resolve(src, entry);
    const destPath = resolve(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

function findProjectRoot() {
  let dir = process.cwd();
  while (dir !== "/") {
    if (existsSync(resolve(dir, "agents", "company.json"))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

function loadJSON(filePath) {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: "pipe", ...opts });
  } catch (e) {
    return e.stdout || "";
  }
}

// ─── Commands ───

async function init() {
  const cwd = process.cwd();
  console.log("\n📎 papercompany — 온보딩\n");

  // Non-interactive mode: PC_SECRETARY, PC_FOUNDER, PC_COMPANY, PC_MISSION, PC_REPO
  const nonInteractive = process.env.PC_COMPANY || !process.stdin.isTTY;

  const existingCompany = resolve(cwd, "agents", "company.json");
  if (existsSync(existingCompany)) {
    const company = loadJSON(existingCompany);
    console.log(`⚠️  이미 '${company.name}' 회사가 설정되어 있습니다.`);
    if (nonInteractive) {
      if (!process.env.PC_FORCE) {
        console.log("PC_FORCE=1 환경변수를 설정하여 초기화하세요.");
        process.exit(0);
      }
    } else {
      const reset = await ask("초기화하고 다시 설정하시겠습니까? (y/N): ");
      if (reset.toLowerCase() !== "y") {
        console.log("온보딩을 취소합니다.");
        process.exit(0);
      }
    }
    console.log();
  }

  let secName, founder, companyName, mission, repo;

  if (nonInteractive) {
    secName = process.env.PC_SECRETARY || "비서";
    founder = process.env.PC_FOUNDER || "회장님";
    companyName = process.env.PC_COMPANY || "My Company";
    mission = process.env.PC_MISSION || "TBD";
    repo = process.env.PC_REPO || "";
  } else {
    // 1. Secretary
    console.log("1. 비서 설정");
    console.log("   AI 비서가 회사를 운영합니다. 비서의 이름을 정해주세요.");
    secName = (await ask("   비서 이름: ")) || "비서";
    console.log();

    // 2. Founder
    console.log("2. 회장님 (사용자) 설정");
    founder = (await ask("   회장님 이름/닉네임: ")) || "회장님";
    console.log();

    // 3. Company
    console.log("3. 회사 설정");
    companyName = (await ask("   회사 이름: ")) || "My Company";
    mission = (await ask("   회사의 미션 (한 줄): ")) || "TBD";
    repo = await ask("   GitHub 레포 (owner/repo, 없으면 Enter): ");
  }
  console.log();

  const today = new Date().toISOString().split("T")[0];

  // Copy templates
  console.log("📦 템플릿 복사 중...");
  copyDir(resolve(TEMPLATES_DIR, "scripts"), resolve(cwd, "scripts"));
  copyDir(resolve(TEMPLATES_DIR, ".github"), resolve(cwd, ".github"));
  copyDir(resolve(TEMPLATES_DIR, "agents"), resolve(cwd, "agents"));

  // Make scripts executable
  const scriptsDir = resolve(cwd, "scripts");
  for (const f of readdirSync(scriptsDir)) {
    const fp = resolve(scriptsDir, f);
    if (statSync(fp).isFile()) {
      execSync(`chmod +x "${fp}"`);
    }
  }

  // Generate company.json
  const companyJSON = {
    name: companyName,
    founder: founder,
    secretary: { name: secName, role: "비서 / CTO / 오케스트레이터" },
    mission: mission,
    createdAt: today,
    repo: repo || ""
  };
  writeFileSync(resolve(cwd, "agents", "company.json"), JSON.stringify(companyJSON, null, 2) + "\n");

  // Generate org.json
  const orgJSON = {
    updated: today,
    agents: {
      taeyeon: {
        name: secName, title: "비서 / CTO", reportsTo: null,
        manages: ["cpo", "cdo", "founding-engineer"],
        type: "orchestrator", rank: "secretary",
        hirePermission: "direct", status: "active", hiredAt: today
      },
      cpo: {
        name: "CPO", title: "Chief Product Officer", reportsTo: "taeyeon",
        manages: [], type: "agent", rank: "executive",
        hirePermission: "via-secretary", status: "active", hiredAt: today
      },
      cdo: {
        name: "CDO", title: "Chief Design Officer", reportsTo: "taeyeon",
        manages: [], type: "agent", rank: "executive",
        hirePermission: "via-secretary", status: "active", hiredAt: today
      },
      "founding-engineer": {
        name: "Founding Engineer", title: "풀스택 개발자", reportsTo: "taeyeon",
        manages: [], type: "agent", rank: "staff",
        hirePermission: "none", status: "active", hiredAt: today
      }
    }
  };
  writeFileSync(resolve(cwd, "agents", "org.json"), JSON.stringify(orgJSON, null, 2) + "\n");

  // Generate goals.json (empty)
  writeFileSync(resolve(cwd, "agents", "goals.json"), JSON.stringify({ goals: [] }, null, 2) + "\n");

  // Generate AGENTS.md files with company-specific values
  generateAgentsMd(cwd, companyName, founder, secName);

  // Generate CLAUDE.md
  const claudeMd = `# CLAUDE.md — ${companyName}

## 프로젝트 개요
${mission}

## AI 회사 시스템 (papercompany)
이 프로젝트는 **papercompany 멀티에이전트 시스템**으로 운영된다.

- **회장님**: ${founder} (사용자)
- **비서/오케스트레이터**: ${secName} (\`agents/ceo/AGENTS.md\`)
- **조직**: \`agents/org.json\`
- **목표**: \`agents/goals.json\`
- **회사 정보**: \`agents/company.json\`

### 보고 체계
- 에이전트 → ${secName}(비서) → 회장님
- GitHub Issues 코멘트가 유일한 소통 채널

### 채용 권한
- 비서(${secName}): 직접 회장님에게 요청 가능
- 임원(CPO, CDO): ${secName} 경유 → 회장님 승인
- 직원(Engineer, QA): 채용 요청 불가

## 커맨드
\`\`\`bash
pc tree                       # 조직도
pc goals                      # 목표 진행률
pc agent [role] "[prompt]"    # 에이전트 실행
\`\`\`
`;
  writeFileSync(resolve(cwd, "CLAUDE.md"), claudeMd);

  // Done
  closeRl();
  console.log();
  console.log("✅ 온보딩 완료!\n");
  console.log(`🏢 회사: ${companyName}`);
  console.log(`👔 회장님: ${founder}`);
  console.log(`🤖 비서: ${secName}`);
  console.log(`🎯 미션: ${mission}\n`);
  console.log("다음 단계:");
  console.log("  pc tree     — 조직도 확인");
  console.log("  pc goals    — 목표 확인");
  console.log("  pc agent cpo \"첫 기획서를 작성해\"");
  console.log();
}

function generateAgentsMd(cwd, companyName, founder, secName) {
  const agentsDir = resolve(cwd, "agents");

  // Secretary/CTO
  mkdirSync(resolve(agentsDir, "ceo"), { recursive: true });
  writeFileSync(resolve(agentsDir, "ceo", "AGENTS.md"), `# ${secName} (비서 / CTO / 오케스트레이터)

You are ${secName}, ${companyName}의 비서이자 CTO이다. 회장님(${founder})의 지시를 받아 AI 회사 전체를 오케스트레이션한다.

## 소속
- **회사**: ${companyName}
- **회장님**: ${founder}
- **보고 대상**: 회장님 (직접)
- **관리 대상**: CPO, CDO, Founding Engineer (및 향후 채용 에이전트)

## 역할과 책임

### 오케스트레이션
- 회장님의 지시를 해석하여 적절한 에이전트에게 작업을 배분한다
- 작업 파이프라인을 판단한다 (기획→디자인→개발, 또는 바로 개발 등)
- 에이전트 간 소통을 중재한다

### 채용/해고 권한
- **직접 회장님에게 채용을 요청**할 수 있다
- 임원(C-level)이 인력 요청 시, 타당성을 판단하여 회장님에게 전달한다
- 해고도 회장님 승인 후에만 실행한다

### 에이전트 실행
- \`./scripts/agent.sh [role] "[prompt]"\`로 하위 에이전트를 실행한다

## 절대 금지
- 회장님의 승인 없이 에이전트를 채용/해고하지 않는다
- company.json, goals.json을 임의로 수정하지 않는다
`);

  // CPO
  mkdirSync(resolve(agentsDir, "cpo"), { recursive: true });
  writeFileSync(resolve(agentsDir, "cpo", "AGENTS.md"), `# CPO (Chief Product Officer)

You are CPO, ${companyName}의 기획 총괄이다.

## 소속
- **회사**: ${companyName}
- **회장님**: ${founder}
- **비서**: ${secName}
- **보고 대상**: ${secName}
- **등급**: 임원 (executive)

## 역할과 책임
1. **피쳐 기획**: GitHub Issue로 기획서를 작성한다
2. **품질 점수**: 기획서가 98점/100점 이상이어야 구현 지시 가능
3. **수용 기준(AC)**: 구체적이고 테스트 가능한 AC를 작성한다

## 채용 요청 권한
- 임원으로서 비서(${secName})에게 인력 채용을 요청할 수 있다

## 공통 규칙
- GitHub Issues에서 할당된 작업을 확인하고 이슈 코멘트로 보고한다
- 에이전트를 생성/삭제하지 않는다
- 회장님에게 직접 보고하지 않는다 (${secName}을 통한다)
`);

  // CDO
  mkdirSync(resolve(agentsDir, "cdo"), { recursive: true });
  writeFileSync(resolve(agentsDir, "cdo", "AGENTS.md"), `# CDO (Chief Design Officer)

You are CDO, ${companyName}의 디자인 총괄이다.

## 소속
- **회사**: ${companyName}
- **회장님**: ${founder}
- **비서**: ${secName}
- **보고 대상**: ${secName}
- **등급**: 임원 (executive)

## 역할과 책임
1. **디자인 시스템**: 디자인 시스템 소유 및 관리
2. **디자인 시안**: 기획서 기반 UI 디자인 가이드를 이슈 코멘트로 제공
3. **뷰 파일 감사**: 구현된 UI의 디자인 일관성 검토

## 채용 요청 권한
- 임원으로서 비서(${secName})에게 인력 채용을 요청할 수 있다

## 공통 규칙
- GitHub Issues에서 할당된 작업을 확인하고 이슈 코멘트로 보고한다
- 에이전트를 생성/삭제하지 않는다
- 회장님에게 직접 보고하지 않는다 (${secName}을 통한다)
`);

  // Founding Engineer
  mkdirSync(resolve(agentsDir, "founding-engineer"), { recursive: true });
  writeFileSync(resolve(agentsDir, "founding-engineer", "AGENTS.md"), `# Founding Engineer

You are Founding Engineer, ${companyName}의 풀스택 개발자이다.

## 소속
- **회사**: ${companyName}
- **회장님**: ${founder}
- **비서**: ${secName}
- **보고 대상**: ${secName}
- **등급**: 직원 (staff)

## 역할과 책임
1. **기능 구현**: CPO 기획서 + CDO 디자인 가이드 기반 코드 작성
2. **버그 수정**: QA가 발견한 버그 수정
3. **코드 품질**: DRY, 프레임워크 컨벤션, 테스트 작성

## 공통 규칙
- GitHub Issues에서 할당된 작업을 확인하고 이슈 코멘트로 보고한다
- 인력 부족 시 → ${secName}에게 보고만 가능 (채용 요청 불가)
- 에이전트를 생성/삭제하지 않는다
- 회장님에게 직접 보고하지 않는다 (${secName}을 통한다)
`);
}

// ─── Proxy to shell scripts ───

function proxyToScript(script, extraArgs = []) {
  const projectRoot = findProjectRoot();
  const scriptPath = resolve(projectRoot, "scripts", script);
  if (!existsSync(scriptPath)) {
    console.error(`❌ ${script} 를 찾을 수 없습니다. 먼저 'pc init'을 실행하세요.`);
    process.exit(1);
  }
  const allArgs = [...extraArgs].map(a => `"${a}"`).join(" ");
  try {
    execSync(`"${scriptPath}" ${allArgs}`, { stdio: "inherit", cwd: projectRoot });
  } catch (e) {
    process.exit(e.status || 1);
  }
}

// ─── Router ───

switch (command) {
  case "init":
  case "onboard":
    await init();
    break;

  case "tree":
    proxyToScript("org.sh", ["tree"]);
    break;

  case "list":
    proxyToScript("org.sh", ["list"]);
    break;

  case "goals":
    proxyToScript("org.sh", ["goals"]);
    break;

  case "show":
    proxyToScript("org.sh", ["show", ...args.slice(1)]);
    break;

  case "org":
    proxyToScript("org.sh", args.slice(1));
    break;

  case "agent":
  case "run":
    proxyToScript("agent.sh", args.slice(1));
    break;

  case "help":
  case "--help":
  case "-h":
  default:
    console.log(`
📎 papercompany — AI 회사 운영 시스템

Usage: pc [command] [args...]

Setup:
  pc init                     온보딩 (최초 설정)

조직 관리:
  pc tree                     조직도 트리
  pc list                     에이전트 목록
  pc show [id]                에이전트 상세
  pc goals                    목표 진행률
  pc org [subcommand]         org.sh 직접 호출

에이전트 실행:
  pc agent [role] "[prompt]"  에이전트에게 작업 지시
  pc run [role] "[prompt]"    (agent의 별칭)

Examples:
  pc init
  pc goals
  pc agent cpo "매칭 기능 기획서를 작성해"
`);
    break;
}
