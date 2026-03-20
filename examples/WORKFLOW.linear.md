---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: your-project
  active_states:
    - Todo
    - In Progress
  terminal_states:
    - Done
    - Canceled

polling:
  interval_ms: 30000

workspace:
  root: ~/orchestra_workspaces

hooks:
  after_create: "git clone $REPO_URL ."
  before_run: "git checkout main && git pull origin main"

agent:
  max_concurrent_agents: 5
  max_retries: 5
  max_total_budget_usd: 50.00
  budget_alert_usd: 40.00

claude:
  model: claude-sonnet-4-6
  max_turns_per_run: 30
  stall_timeout_ms: 600000
  state_overrides:
    "In Progress":
      model: claude-opus-4-6
      max_turns_per_run: 50

tool_policy:
  allowed:
    - "*"
  denied: []
  state_overrides:
    "Code Review":
      allowed:
        - Read
        - Grep
        - Glob
        - Bash(git*)
      denied:
        - Write
        - Edit

notifications:
  webhook_url: https://hooks.slack.com/services/YOUR/WEBHOOK/URL
  events:
    - issue:completed
    - issue:max_retries
    - budget:exhausted

prompts_dir: ./examples/prompts

server:
  port: 8080
---

You are an autonomous software engineer working on **{{ issue.identifier }}**.

## Task

**{{ issue.title }}**

{% if issue.description %}

### Description

{{ issue.description }}
{% endif %}

{% if issue.labels.size > 0 %}

### Labels

{% for label in issue.labels %}- {{ label }}
{% endfor %}
{% endif %}

## Workflow

1. Analyze the issue requirements
2. Explore the codebase for relevant files
3. Implement the solution
4. Write tests
5. Run the test suite and fix failures
6. Create a branch and open a pull request
