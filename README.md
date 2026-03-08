# 📎 papercompany

**AI company operating system** — Hire an AI secretary, build a company of AI agents.

papercompany turns your project into an AI-operated company. You're the chairman. Your AI secretary orchestrates a team of AI agents (CPO, CDO, Engineer, QA...) through GitHub Issues.

```
Chairman (you)
  │  "Build a matching feature"
  ▼
Secretary (AI orchestrator)
  │  Judges → Plans → Delegates → Reports
  ▼
┌─────────────────────────────┐
│  AI Company (agent org)      │
│  CPO → CDO → Engineer → QA  │
│  Communicates via GitHub     │
└─────────────────────────────┘
```

## Quick Start

```bash
# Install globally
npm install -g papercompany

# Initialize in your project
cd your-project
pc init

# See your org
pc tree

# Run an agent
pc agent cpo "Write a spec for the matching feature"
```

## Requirements

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude` command)
- [GitHub CLI](https://cli.github.com/) (`gh` command)
- `jq` (JSON processing)
- Node.js >= 18

## How It Works

### 1. Onboarding (`pc init`)

Interactive setup that creates your AI company:
- Name your AI secretary
- Name your company
- Set your mission
- Auto-generates org structure, agent configs, and CLAUDE.md

### 2. Organization

```bash
pc tree       # Org chart
pc list       # Agent table
pc show cpo   # Agent details
pc goals      # Goal progress with KRs
```

### 3. Run Agents

```bash
pc agent [role] "[prompt]"

# Examples
pc agent cpo "Write a product spec for user profiles"
pc agent cdo "Design the navigation bar"
pc agent engineer "Implement Issue #5"
```

## Architecture

### Agent Hierarchy

| Rank | Examples | Hire Permission |
|---|---|---|
| Secretary | AI orchestrator | Can request chairman directly |
| Executive | CPO, CDO | Request via secretary → chairman approval |
| Staff | Engineer, QA | Cannot request (report only) |

### Reporting Chain

```
Agents → Secretary → Chairman
```

- Agents report **upward only** through the secretary
- No lateral commands between agents
- GitHub Issues comments are the sole communication channel

### Goal System

```
Goal (agents/goals.json)
  ├─ GitHub Milestone
  │   ├─ Issue #1
  │   └─ Issue #2
  └─ Key Results
      ├─ ✅ Completed KR
      └─ ⬜ Pending KR
```

## File Structure

After `pc init`, your project gets:

```
your-project/
├─ agents/
│  ├─ company.json              # Company info
│  ├─ goals.json                # Goals + Key Results
│  ├─ org.json                  # Org chart
│  ├─ TEMPLATE.md               # Agent creation template
│  ├─ ceo/AGENTS.md             # Secretary (orchestrator)
│  ├─ cpo/AGENTS.md             # CPO
│  ├─ cdo/AGENTS.md             # CDO
│  └─ founding-engineer/AGENTS.md
├─ scripts/
│  ├─ org.sh                    # Org management
│  └─ agent.sh                  # Agent runner
├─ .github/ISSUE_TEMPLATE/      # GitHub Issue templates
└─ CLAUDE.md                    # Project context (auto-generated)
```

## Commands

| Command | Description |
|---|---|
| `pc init` | Onboarding (first-time setup) |
| `pc tree` | Org chart tree |
| `pc list` | Agent list table |
| `pc show [id]` | Agent details |
| `pc goals` | Goal progress |
| `pc agent [role] "[prompt]"` | Run an agent |
| `pc run [role] "[prompt]"` | Alias for agent |
| `pc org [subcommand]` | Direct org.sh call |

## License

MIT
