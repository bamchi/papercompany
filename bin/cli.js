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
    console.log("   GitHub 레포는 에이전트가 이슈로 소통하는 공간입니다.");
    repo = await ask("   GitHub 레포 (owner/repo, 나중에 설정하려면 Enter): ");
  }
  console.log();

  const today = new Date().toISOString().split("T")[0];

  // ─── GitHub 설정 ───
  if (repo) {
    console.log("🔗 GitHub 설정 중...\n");

    // 1. gh CLI 확인
    const ghVersion = run("gh --version 2>/dev/null");
    if (!ghVersion) {
      console.log("⚠️  gh CLI가 설치되어 있지 않습니다.");
      console.log("   설치: https://cli.github.com/");
      console.log("   GitHub 설정을 건너뜁니다. 나중에 'pc github setup'으로 설정할 수 있습니다.\n");
    } else {
      // 2. 인증 확인
      const ghAuth = run("gh auth status 2>&1");
      if (ghAuth.includes("not logged")) {
        console.log("⚠️  gh CLI 인증이 필요합니다.");
        console.log("   실행: gh auth login");
        console.log("   GitHub 설정을 건너뜁니다.\n");
      } else {
        // 3. repo 존재 확인 또는 생성
        const repoCheck = run(`gh repo view ${repo} --json name 2>&1`);
        if (repoCheck.includes("not found") || repoCheck.includes("Could not resolve")) {
          if (nonInteractive) {
            console.log(`   📦 레포 생성: ${repo}`);
            run(`gh repo create ${repo} --private --confirm 2>&1`);
          } else {
            const createRepo = await ask(`   레포 '${repo}'가 없습니다. 생성할까요? (Y/n): `);
            if (createRepo.toLowerCase() !== "n") {
              const visibility = await ask("   공개 범위 (public/private, 기본: private): ");
              const vis = visibility === "public" ? "--public" : "--private";
              const result = run(`gh repo create ${repo} ${vis} --confirm 2>&1`);
              if (result.includes("https://")) {
                console.log(`   ✅ 레포 생성 완료: ${repo}`);
              } else {
                console.log(`   ⚠️  레포 생성 실패: ${result.trim()}`);
              }
            }
          }
        } else {
          console.log(`   ✅ 레포 확인: ${repo}`);
        }

        // 4. 라벨 생성
        console.log("   🏷️  라벨 설정 중...");
        const labels = [
          { name: "role:secretary", color: "6f42c1", description: "비서/오케스트레이터 담당" },
          { name: "role:cpo", color: "0075ca", description: "CPO 담당" },
          { name: "role:cdo", color: "e4e669", description: "CDO 담당" },
          { name: "role:engineer", color: "0e8a16", description: "엔지니어 담당" },
          { name: "pipeline:planning", color: "d876e3", description: "기획 단계" },
          { name: "pipeline:design", color: "f9d0c4", description: "디자인 단계" },
          { name: "pipeline:development", color: "bfd4f2", description: "개발 단계" },
          { name: "pipeline:review", color: "c2e0c6", description: "리뷰 단계" },
        ];
        for (const label of labels) {
          run(`gh label create "${label.name}" --repo ${repo} --color "${label.color}" --description "${label.description}" --force 2>&1`);
        }
        console.log(`   ✅ ${labels.length}개 라벨 생성 완료`);

        // 5. git remote 설정 (현재 디렉토리가 git repo인 경우)
        if (existsSync(resolve(cwd, ".git"))) {
          const remotes = run("git remote -v");
          if (!remotes.includes("origin")) {
            run(`git remote add origin https://github.com/${repo}.git`);
            console.log(`   ✅ git remote origin 설정: ${repo}`);
          }
        }

        console.log();
      }
    }
  }

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
      secretary: {
        name: secName, title: "비서 / CTO", reportsTo: null,
        manages: ["cpo", "cdo", "founding-engineer"],
        type: "orchestrator", rank: "secretary",
        hirePermission: "direct", status: "active", hiredAt: today
      },
      cpo: {
        name: "CPO", title: "Chief Product Officer", reportsTo: "secretary",
        manages: [], type: "agent", rank: "executive",
        hirePermission: "via-secretary", status: "active", hiredAt: today
      },
      cdo: {
        name: "CDO", title: "Chief Design Officer", reportsTo: "secretary",
        manages: [], type: "agent", rank: "executive",
        hirePermission: "via-secretary", status: "active", hiredAt: today
      },
      "founding-engineer": {
        name: "Founding Engineer", title: "풀스택 개발자", reportsTo: "secretary",
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
pc list                       # 에이전트 목록
pc hire [id] [title]          # 에이전트 채용
pc fire [id]                  # 에이전트 해고
pc goals                      # 목표 진행률
pc goals add [title]          # 목표 추가
pc goals kr [id] [kr]         # KR 추가/토글
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
  if (!repo) {
    console.log("  pc github setup  — GitHub 레포/라벨 설정 (필수)");
  }
  console.log("  pc tree          — 조직도 확인");
  console.log("  pc goals         — 목표 확인");
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

async function githubSetup() {
  const projectRoot = findProjectRoot();
  const companyFile = resolve(projectRoot, "agents", "company.json");

  if (!existsSync(companyFile)) {
    console.log("❌ 먼저 'pc init'을 실행하세요.");
    process.exit(1);
  }

  const company = loadJSON(companyFile);
  let repo = company.repo;

  console.log("\n🔗 GitHub 설정\n");

  // gh CLI 확인
  const ghVersion = run("gh --version 2>/dev/null");
  if (!ghVersion) {
    console.log("❌ gh CLI가 필요합니다.");
    console.log("   설치: https://cli.github.com/");
    process.exit(1);
  }

  // 인증 확인
  const ghAuth = run("gh auth status 2>&1");
  if (ghAuth.includes("not logged")) {
    console.log("❌ gh CLI 인증이 필요합니다.");
    console.log("   실행: gh auth login");
    process.exit(1);
  }

  // repo 설정
  if (!repo) {
    repo = await ask("   GitHub 레포 (owner/repo): ");
    if (!repo) {
      console.log("❌ 레포를 입력하세요.");
      closeRl();
      process.exit(1);
    }
    // company.json에 repo 저장
    company.repo = repo;
    writeFileSync(companyFile, JSON.stringify(company, null, 2) + "\n");
  }
  console.log(`   레포: ${repo}`);

  // repo 존재 확인 또는 생성
  const repoCheck = run(`gh repo view ${repo} --json name 2>&1`);
  if (repoCheck.includes("not found") || repoCheck.includes("Could not resolve")) {
    const createRepo = await ask(`   레포 '${repo}'가 없습니다. 생성할까요? (Y/n): `);
    if (createRepo.toLowerCase() !== "n") {
      const visibility = await ask("   공개 범위 (public/private, 기본: private): ");
      const vis = visibility === "public" ? "--public" : "--private";
      run(`gh repo create ${repo} ${vis} --confirm 2>&1`);
      console.log(`   ✅ 레포 생성 완료`);
    }
  } else {
    console.log("   ✅ 레포 확인됨");
  }

  // 라벨 생성
  console.log("   🏷️  라벨 설정 중...");
  const orgFile = resolve(projectRoot, "agents", "org.json");
  const org = loadJSON(orgFile);
  const agentIds = org ? Object.keys(org.agents) : [];

  // 기본 라벨 + 에이전트별 라벨
  const labels = [
    { name: "pipeline:planning", color: "d876e3", description: "기획 단계" },
    { name: "pipeline:design", color: "f9d0c4", description: "디자인 단계" },
    { name: "pipeline:development", color: "bfd4f2", description: "개발 단계" },
    { name: "pipeline:review", color: "c2e0c6", description: "리뷰 단계" },
  ];
  const roleColors = ["6f42c1", "0075ca", "e4e669", "0e8a16", "d93f0b", "fbca04", "b60205", "5319e7"];
  for (let i = 0; i < agentIds.length; i++) {
    labels.push({
      name: `role:${agentIds[i]}`,
      color: roleColors[i % roleColors.length],
      description: `${org.agents[agentIds[i]].title} 담당`
    });
  }

  for (const label of labels) {
    run(`gh label create "${label.name}" --repo ${repo} --color "${label.color}" --description "${label.description}" --force 2>&1`);
  }
  console.log(`   ✅ ${labels.length}개 라벨 생성 완료`);

  // 이슈 템플릿 복사
  const githubDir = resolve(projectRoot, ".github", "ISSUE_TEMPLATE");
  if (!existsSync(githubDir)) {
    copyDir(resolve(TEMPLATES_DIR, ".github"), resolve(projectRoot, ".github"));
    console.log("   ✅ 이슈 템플릿 복사 완료");
  }

  // git remote 설정
  if (existsSync(resolve(projectRoot, ".git"))) {
    const remotes = run("git remote -v");
    if (!remotes.includes("origin")) {
      run(`git remote add origin https://github.com/${repo}.git`);
      console.log(`   ✅ git remote origin 설정`);
    }
  } else {
    console.log("   ℹ️  git repo가 아닙니다. 'git init' 후 remote를 수동으로 설정하세요.");
  }

  closeRl();
  console.log("\n✅ GitHub 설정 완료!\n");
  console.log("다음 단계:");
  console.log("  pc goals add \"첫 번째 목표\"");
  console.log("  pc heartbeat start");
  console.log();
}

// ─── Doctor ───

async function doctor() {
  const projectRoot = findProjectRoot();
  const agentsDir = resolve(projectRoot, "agents");
  const companyFile = resolve(agentsDir, "company.json");
  const orgFile = resolve(agentsDir, "org.json");
  const goalsFile = resolve(agentsDir, "goals.json");
  const templateFile = resolve(agentsDir, "TEMPLATE.md");

  console.log("\n🩺 papercompany doctor\n");

  let errors = 0;
  let warnings = 0;
  let fixes = [];

  function pass(msg) { console.log(`  ✅ ${msg}`); }
  function fail(msg) { console.log(`  ❌ ${msg}`); errors++; }
  function warn(msg) { console.log(`  ⚠️  ${msg}`); warnings++; }

  // ── 1. 핵심 파일 존재 ──
  console.log("── 핵심 파일 ──");

  if (!existsSync(companyFile)) {
    fail("agents/company.json 없음");
    fixes.push({ id: "init", label: "pc init 실행 (전체 초기화)", run: "init" });
    // company.json 없으면 나머지 검사 불가
    console.log(`\n📊 결과: ${errors} 오류, ${warnings} 경고\n`);
    console.log("💡 먼저 'pc init'을 실행하세요.");
    closeRl();
    return;
  }
  pass("agents/company.json");

  if (!existsSync(orgFile)) {
    fail("agents/org.json 없음");
    fixes.push({ id: "org", label: "org.json 재생성", run: "org" });
  } else {
    pass("agents/org.json");
  }

  if (!existsSync(goalsFile)) {
    fail("agents/goals.json 없음");
    fixes.push({ id: "goals", label: "goals.json 재생성 (빈 목표)", run: "goals" });
  } else {
    pass("agents/goals.json");
  }

  if (!existsSync(templateFile)) {
    fail("agents/TEMPLATE.md 없음");
    fixes.push({ id: "template", label: "TEMPLATE.md 복사", run: "template" });
  } else {
    pass("agents/TEMPLATE.md");
  }

  if (!existsSync(resolve(projectRoot, "scripts", "org.sh"))) {
    fail("scripts/org.sh 없음");
    fixes.push({ id: "scripts", label: "스크립트 재복사", run: "scripts" });
  } else {
    pass("scripts/org.sh");
  }

  if (!existsSync(resolve(projectRoot, "scripts", "agent.sh"))) {
    fail("scripts/agent.sh 없음");
    if (!fixes.find(f => f.id === "scripts")) {
      fixes.push({ id: "scripts", label: "스크립트 재복사", run: "scripts" });
    }
  } else {
    pass("scripts/agent.sh");
  }

  if (!existsSync(resolve(projectRoot, "CLAUDE.md"))) {
    warn("CLAUDE.md 없음 (에이전트가 프로젝트를 이해하지 못할 수 있음)");
    fixes.push({ id: "claude", label: "CLAUDE.md 재생성", run: "claude" });
  } else {
    pass("CLAUDE.md");
  }

  // ── 2. company.json 검증 ──
  console.log("\n── 회사 설정 ──");
  const company = loadJSON(companyFile);

  if (!company.name || company.name === "My Company") {
    warn("회사 이름이 기본값입니다");
  } else {
    pass(`회사: ${company.name}`);
  }

  if (!company.founder || company.founder === "회장님") {
    warn("회장님 이름이 기본값입니다");
  } else {
    pass(`회장님: ${company.founder}`);
  }

  if (!company.secretary || !company.secretary.name || company.secretary.name === "비서") {
    warn("비서 이름이 기본값입니다");
  } else {
    pass(`비서: ${company.secretary.name}`);
  }

  if (!company.mission || company.mission === "TBD") {
    warn("미션이 설정되지 않았습니다");
  } else {
    pass(`미션: ${company.mission}`);
  }

  // ── 3. GitHub 설정 ──
  console.log("\n── GitHub ──");
  if (!company.repo) {
    fail("GitHub 레포 미설정 (에이전트 간 이슈 소통 불가)");
    fixes.push({ id: "github", label: "pc github setup 실행", run: "github" });
  } else {
    pass(`레포: ${company.repo}`);

    // gh CLI 확인
    const ghVersion = run("gh --version 2>/dev/null");
    if (!ghVersion) {
      warn("gh CLI 미설치 (https://cli.github.com/)");
    } else {
      pass("gh CLI 설치됨");

      const ghAuth = run("gh auth status 2>&1");
      if (ghAuth.includes("not logged")) {
        warn("gh CLI 미인증 (gh auth login 필요)");
      } else {
        pass("gh CLI 인증됨");

        // 레포 접근 확인
        const repoCheck = run(`gh repo view ${company.repo} --json name 2>&1`);
        if (repoCheck.includes("not found") || repoCheck.includes("Could not resolve")) {
          fail(`레포 '${company.repo}' 접근 불가`);
          fixes.push({ id: "github", label: "pc github setup 실행", run: "github" });
        } else {
          pass("레포 접근 가능");

          // 라벨 확인
          const labelsOut = run(`gh label list --repo ${company.repo} --limit 100 2>&1`);
          const hasRoleLabels = labelsOut.includes("role:");
          const hasPipelineLabels = labelsOut.includes("pipeline:");
          if (!hasRoleLabels || !hasPipelineLabels) {
            warn("GitHub 라벨 누락 (role: 또는 pipeline:)");
            if (!fixes.find(f => f.id === "github")) {
              fixes.push({ id: "github", label: "pc github setup 실행 (라벨 재생성)", run: "github" });
            }
          } else {
            pass("GitHub 라벨 설정됨");
          }
        }
      }
    }

    // git remote 확인
    if (existsSync(resolve(projectRoot, ".git"))) {
      const remotes = run("git remote -v");
      if (!remotes.includes("origin")) {
        warn("git remote origin 미설정");
      } else {
        pass("git remote origin 설정됨");
      }
    }
  }

  // ── 4. 조직 검증 ──
  console.log("\n── 조직 ──");
  const org = loadJSON(orgFile);

  if (org) {
    const agents = org.agents || {};
    const agentIds = Object.keys(agents);
    const activeAgents = agentIds.filter(id => agents[id].status === "active");

    // 비서 확인
    if (!agents.secretary) {
      fail("비서(secretary) 에이전트 없음 in org.json");
      // 레거시 taeyeon 키 확인
      if (agents.taeyeon) {
        warn("레거시 'taeyeon' 키 발견 — 'secretary'로 마이그레이션 필요");
        fixes.push({ id: "migrate-secretary", label: "비서 키 마이그레이션 (taeyeon → secretary)", run: "migrate-secretary" });
      }
    } else {
      pass(`비서: ${agents.secretary.name} (${agents.secretary.title})`);
    }

    // C-level(임원) 확인
    const executives = activeAgents.filter(id => agents[id].rank === "executive");
    if (executives.length === 0) {
      fail("활성 임원(C-level) 에이전트 없음 — 최소 1명 필요");
      fixes.push({ id: "hire-exec", label: "임원 에이전트 채용 (CPO 추천)", run: "hire-exec" });
    } else {
      pass(`임원: ${executives.map(id => agents[id].name || id).join(", ")} (${executives.length}명)`);
    }

    // AGENTS.md 파일 존재 확인
    const missingMd = [];
    for (const id of activeAgents) {
      // secretary → ceo 폴더, 나머지는 id 그대로
      const folderName = id === "secretary" ? "ceo" : id;
      const mdPath = resolve(agentsDir, folderName, "AGENTS.md");
      if (!existsSync(mdPath)) {
        missingMd.push(id);
      }
    }
    if (missingMd.length > 0) {
      fail(`AGENTS.md 누락: ${missingMd.join(", ")}`);
      fixes.push({ id: "fix-agents-md", label: "누락된 AGENTS.md 생성", run: "fix-agents-md", data: missingMd });
    } else {
      pass(`AGENTS.md: ${activeAgents.length}개 모두 존재`);
    }

    // manages 정합성 — manages에 있는데 org.json에 없거나 terminated
    for (const id of activeAgents) {
      const manages = agents[id].manages || [];
      for (const sub of manages) {
        if (!agents[sub]) {
          warn(`${id}.manages에 '${sub}' 있지만 org.json에 에이전트 없음`);
        } else if (agents[sub].status === "terminated") {
          warn(`${id}.manages에 '${sub}' 있지만 해고 상태`);
        }
      }
    }

    // org.json에는 있지만 AGENTS.md 폴더가 있는 유령 에이전트
    if (existsSync(agentsDir)) {
      const folders = readdirSync(agentsDir).filter(f => {
        const fp = resolve(agentsDir, f);
        return statSync(fp).isDirectory() && existsSync(resolve(fp, "AGENTS.md"));
      });
      for (const folder of folders) {
        // ceo → secretary 매핑
        const orgId = folder === "ceo" ? "secretary" : folder;
        if (!agents[orgId]) {
          warn(`agents/${folder}/AGENTS.md 존재하지만 org.json에 미등록`);
        }
      }
    }

    pass(`총 에이전트: ${activeAgents.length}명 활성 / ${agentIds.length}명 전체`);
  }

  // ── 5. 목표 검증 ──
  console.log("\n── 목표 ──");
  const goals = loadJSON(goalsFile);

  if (goals) {
    if (!goals.goals || goals.goals.length === 0) {
      warn("목표가 없습니다 — 'pc goals add' 로 추가하세요");
    } else {
      const activeGoals = goals.goals.filter(g => g.status === "active");
      pass(`목표: ${activeGoals.length}개 활성 / ${goals.goals.length}개 전체`);

      // KR 없는 목표
      const noKr = goals.goals.filter(g => g.status === "active" && (!g.keyResults || g.keyResults.length === 0));
      if (noKr.length > 0) {
        warn(`KR 없는 목표: ${noKr.map(g => g.id).join(", ")}`);
      }
    }
  }

  // ── 6. 의존성 ──
  console.log("\n── 의존성 ──");
  const jqVersion = run("jq --version 2>/dev/null");
  if (!jqVersion) {
    fail("jq 미설치 (org.sh에 필요)");
  } else {
    pass(`jq ${jqVersion.trim()}`);
  }

  const claudeVersion = run("claude --version 2>/dev/null");
  if (!claudeVersion) {
    warn("claude CLI 미설치 (에이전트 실행에 필요)");
  } else {
    pass(`claude ${claudeVersion.trim()}`);
  }

  // ── 결과 ──
  console.log(`\n${"─".repeat(40)}`);
  if (errors === 0 && warnings === 0) {
    console.log("🎉 모든 검사 통과! 시스템이 정상입니다.\n");
  } else {
    console.log(`📊 결과: ${errors} 오류, ${warnings} 경고\n`);
  }

  // ── 자동 수정 제안 ──
  if (fixes.length > 0) {
    console.log("🔧 자동 수정 가능:");
    for (let i = 0; i < fixes.length; i++) {
      console.log(`  ${i + 1}. ${fixes[i].label}`);
    }

    if (process.stdin.isTTY) {
      console.log();
      const answer = await ask("수정할 항목 번호를 입력하세요 (전체: a, 건너뛰기: Enter): ");

      if (answer.toLowerCase() === "a") {
        for (const fix of fixes) {
          await applyFix(fix, projectRoot);
        }
      } else if (answer) {
        const idx = parseInt(answer) - 1;
        if (idx >= 0 && idx < fixes.length) {
          await applyFix(fixes[idx], projectRoot);
        }
      }
    } else {
      console.log("\n💡 대화형 모드에서 'pc doctor'를 실행하면 자동 수정을 선택할 수 있습니다.\n");
    }
  }

  closeRl();
}

async function applyFix(fix, projectRoot) {
  const agentsDir = resolve(projectRoot, "agents");
  const companyFile = resolve(agentsDir, "company.json");

  console.log(`\n🔧 수정 중: ${fix.label}...`);

  switch (fix.run) {
    case "init":
      console.log("   → 'pc init'을 직접 실행하세요.");
      break;

    case "org": {
      const company = loadJSON(companyFile);
      const today = new Date().toISOString().split("T")[0];
      const orgJSON = {
        updated: today,
        agents: {
          secretary: {
            name: company.secretary.name, title: "비서 / CTO", reportsTo: null,
            manages: ["cpo", "cdo", "founding-engineer"],
            type: "orchestrator", rank: "secretary",
            hirePermission: "direct", status: "active", hiredAt: today
          },
          cpo: {
            name: "CPO", title: "Chief Product Officer", reportsTo: "secretary",
            manages: [], type: "agent", rank: "executive",
            hirePermission: "via-secretary", status: "active", hiredAt: today
          },
          cdo: {
            name: "CDO", title: "Chief Design Officer", reportsTo: "secretary",
            manages: [], type: "agent", rank: "executive",
            hirePermission: "via-secretary", status: "active", hiredAt: today
          },
          "founding-engineer": {
            name: "Founding Engineer", title: "풀스택 개발자", reportsTo: "secretary",
            manages: [], type: "agent", rank: "staff",
            hirePermission: "none", status: "active", hiredAt: today
          }
        }
      };
      writeFileSync(resolve(agentsDir, "org.json"), JSON.stringify(orgJSON, null, 2) + "\n");
      console.log("   ✅ org.json 생성 완료");
      break;
    }

    case "goals":
      writeFileSync(resolve(agentsDir, "goals.json"), JSON.stringify({ goals: [] }, null, 2) + "\n");
      console.log("   ✅ goals.json 생성 완료");
      break;

    case "template":
      copyDir(resolve(TEMPLATES_DIR, "agents"), agentsDir);
      console.log("   ✅ TEMPLATE.md 복사 완료");
      break;

    case "scripts":
      copyDir(resolve(TEMPLATES_DIR, "scripts"), resolve(projectRoot, "scripts"));
      for (const f of readdirSync(resolve(projectRoot, "scripts"))) {
        const fp = resolve(projectRoot, "scripts", f);
        if (statSync(fp).isFile()) execSync(`chmod +x "${fp}"`);
      }
      console.log("   ✅ 스크립트 복사 완료");
      break;

    case "claude": {
      const company = loadJSON(companyFile);
      const secName = company.secretary?.name || "비서";
      const claudeMd = `# CLAUDE.md — ${company.name}

## 프로젝트 개요
${company.mission}

## AI 회사 시스템 (papercompany)
이 프로젝트는 **papercompany 멀티에이전트 시스템**으로 운영된다.

- **회장님**: ${company.founder} (사용자)
- **비서/오케스트레이터**: ${secName} (\`agents/ceo/AGENTS.md\`)
- **조직**: \`agents/org.json\`
- **목표**: \`agents/goals.json\`
- **회사 정보**: \`agents/company.json\`

### 보고 체계
- 에이전트 → ${secName}(비서) → 회장님
- GitHub Issues 코멘트가 유일한 소통 채널

## 커맨드
\`\`\`bash
pc tree                       # 조직도
pc list                       # 에이전트 목록
pc hire [id] [title]          # 에이전트 채용
pc fire [id]                  # 에이전트 해고
pc goals                      # 목표 진행률
pc goals add [title]          # 목표 추가
pc goals kr [id] [kr]         # KR 추가/토글
pc agent [role] "[prompt]"    # 에이전트 실행
pc doctor                     # 시스템 점검
\`\`\`
`;
      writeFileSync(resolve(projectRoot, "CLAUDE.md"), claudeMd);
      console.log("   ✅ CLAUDE.md 생성 완료");
      break;
    }

    case "github":
      console.log("   → 'pc github setup'을 직접 실행하세요.");
      break;

    case "migrate-secretary": {
      const orgPath = resolve(agentsDir, "org.json");
      const org = loadJSON(orgPath);
      if (org.agents.taeyeon) {
        org.agents.secretary = { ...org.agents.taeyeon };
        delete org.agents.taeyeon;
        // reportsTo 참조도 수정
        for (const [id, agent] of Object.entries(org.agents)) {
          if (agent.reportsTo === "taeyeon") {
            agent.reportsTo = "secretary";
          }
          if (agent.manages) {
            agent.manages = agent.manages.map(m => m === "taeyeon" ? "secretary" : m);
          }
        }
        org.updated = new Date().toISOString().split("T")[0];
        writeFileSync(orgPath, JSON.stringify(org, null, 2) + "\n");
        console.log("   ✅ taeyeon → secretary 마이그레이션 완료");
      }
      break;
    }

    case "hire-exec":
      console.log("   → 'pc hire cpo \"Chief Product Officer\" executive'를 실행하세요.");
      break;

    case "fix-agents-md": {
      const company = loadJSON(companyFile);
      const secName = company.secretary?.name || "비서";
      for (const id of (fix.data || [])) {
        const folderName = id === "secretary" ? "ceo" : id;
        const agentDir = resolve(agentsDir, folderName);
        mkdirSync(agentDir, { recursive: true });
        const org = loadJSON(resolve(agentsDir, "org.json"));
        const agent = org?.agents?.[id];
        if (agent && existsSync(resolve(agentsDir, "TEMPLATE.md"))) {
          const template = readFileSync(resolve(agentsDir, "TEMPLATE.md"), "utf-8");
          const filled = template
            .replace(/\[에이전트명\]/g, agent.name || id)
            .replace(/\[회사명\]/g, company.name)
            .replace(/\[역할\]/g, agent.title)
            .replace(/\[company\.name\]/g, company.name)
            .replace(/\[company\.founder\]/g, company.founder)
            .replace(/\[company\.secretary\.name\]/g, secName)
            .replace(/\[reportsTo\]/g, agent.reportsTo || "secretary");
          writeFileSync(resolve(agentDir, "AGENTS.md"), filled);
          console.log(`   ✅ agents/${folderName}/AGENTS.md 생성`);
        }
      }
      break;
    }
  }
}

// ─── Issues ───

function issues(subArgs) {
  const projectRoot = findProjectRoot();
  const companyFile = resolve(projectRoot, "agents", "company.json");
  const company = loadJSON(companyFile);

  if (!company || !company.repo) {
    console.log("❌ GitHub 레포가 설정되지 않았습니다. 먼저 'pc github setup'을 실행하세요.");
    process.exit(1);
  }

  const repo = company.repo;
  const sub = subArgs[0];

  // pc issues create "제목" [--label role:cpo]
  if (sub === "create" || sub === "new") {
    const title = subArgs[1];
    if (!title) {
      console.log("Usage: pc issues create \"제목\" [--label role:cpo] [--milestone v1.0]");
      process.exit(1);
    }
    const extra = subArgs.slice(2).join(" ");
    try {
      execSync(`gh issue create --repo ${repo} --title "${title}" ${extra}`, { stdio: "inherit" });
    } catch (e) {
      process.exit(e.status || 1);
    }
    return;
  }

  // pc issues show 12
  if (sub === "show" || sub === "view") {
    const num = subArgs[1];
    if (!num) {
      console.log("Usage: pc issues show [번호]");
      process.exit(1);
    }
    try {
      execSync(`gh issue view ${num} --repo ${repo}`, { stdio: "inherit" });
    } catch (e) {
      process.exit(e.status || 1);
    }
    return;
  }

  // pc issues close 12
  if (sub === "close") {
    const num = subArgs[1];
    if (!num) {
      console.log("Usage: pc issues close [번호]");
      process.exit(1);
    }
    try {
      execSync(`gh issue close ${num} --repo ${repo}`, { stdio: "inherit" });
    } catch (e) {
      process.exit(e.status || 1);
    }
    return;
  }

  // pc issues [role] — 역할별 필터 or 전체 목록
  let labelFilter = "";
  if (sub && !sub.startsWith("-")) {
    // role 이름이면 라벨 필터
    labelFilter = `--label "role:${sub}"`;
  }

  try {
    execSync(`gh issue list --repo ${repo} ${labelFilter} --state open`, { stdio: "inherit" });
  } catch (e) {
    process.exit(e.status || 1);
  }
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
    if (args[1] === "add") {
      proxyToScript("org.sh", ["goals-add", ...args.slice(2)]);
    } else if (args[1] === "kr") {
      proxyToScript("org.sh", ["goals-kr", ...args.slice(2)]);
    } else {
      proxyToScript("org.sh", ["goals"]);
    }
    break;

  case "show":
    proxyToScript("org.sh", ["show", ...args.slice(1)]);
    break;

  case "hire":
    proxyToScript("org.sh", ["hire", ...args.slice(1)]);
    break;

  case "fire":
    proxyToScript("org.sh", ["fire", ...args.slice(1)]);
    break;

  case "issues":
  case "issue":
  case "i":
    issues(args.slice(1));
    break;

  case "github":
    if (args[1] === "setup") {
      await githubSetup();
    } else {
      console.log("Usage: pc github setup");
    }
    break;

  case "doctor":
  case "check":
    await doctor();
    break;

  case "heartbeat":
  case "hb":
    proxyToScript("heartbeat.sh", args.slice(1));
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
  pc github setup             GitHub 레포/라벨/이슈템플릿 설정

조직 관리:
  pc tree                     조직도 트리
  pc list                     에이전트 목록
  pc show [id]                에이전트 상세
  pc hire [id] [title]        에이전트 채용
  pc fire [id]                에이전트 해고

목표 관리:
  pc goals                    목표 진행률
  pc goals add [title]        목표 추가
  pc goals kr [id] [kr]       KR 추가/토글

이슈 관리:
  pc issues                   전체 이슈 목록
  pc issues [role]            역할별 이슈 (예: pc issues cpo)
  pc issues create "제목"     이슈 생성
  pc issues show [번호]       이슈 상세
  pc issues close [번호]      이슈 닫기
  pc i                        (issues 별칭)

에이전트 실행:
  pc agent [role] "[prompt]"  에이전트에게 작업 지시
  pc run [role] "[prompt]"    (agent의 별칭)

Heartbeat:
  pc heartbeat start          데몬 시작 (백그라운드)
  pc heartbeat stop           데몬 중지
  pc heartbeat status         상태 확인
  pc heartbeat set [id] [sec] 에이전트별 주기 설정
  pc hb                       (heartbeat 별칭)

진단:
  pc doctor                   시스템 점검 + 자동 수정
  pc check                    (doctor 별칭)

기타:
  pc org [subcommand]         org.sh 직접 호출

Examples:
  pc init
  pc goals
  pc hire tester "QA 엔지니어"
  pc goals add "MVP 론칭"
  pc goals kr goal-1 "회원가입 동작"
  pc agent cpo "매칭 기능 기획서를 작성해"
`);
    break;
}
