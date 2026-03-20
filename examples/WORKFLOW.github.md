---
tracker:
  kind: github
  owner: your-org
  repo: your-repo
  active_states:
    - todo
    - in-progress
  terminal_states:
    - done

polling:
  interval_ms: 30000

workspace:
  root: ~/orchestra_workspaces

hooks:
  after_create: "git clone https://github.com/your-org/your-repo.git ."
  before_run: "git checkout main && git pull origin main"

agent:
  max_concurrent_agents: 3
  max_retries: 5

claude:
  model: claude-sonnet-4-6
  max_turns_per_run: 30
  stall_timeout_ms: 600000

prompts_dir: ./examples/prompts

server:
  port: 8080
---

Work on GitHub issue **{{ issue.identifier }}**: {{ issue.title }}

{% if issue.description %}

## Description

{{ issue.description }}
{% endif %}

Complete this issue by implementing the changes, writing tests, and opening a pull request.
