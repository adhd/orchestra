---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: your-project-slug
  active_states:
    - Todo
    - In Progress
  terminal_states:
    - Done
    - Canceled
    - Cancelled
    - Closed

polling:
  interval_ms: 30000

workspace:
  root: ~/orchestra_workspaces

hooks:
  after_create: "git clone $REPO_URL . || true"
  before_run: "git checkout main && git pull"

agent:
  max_concurrent_agents: 5
  max_turns: 20

claude:
  model: claude-sonnet-4-6
  max_turns_per_run: 30
  stall_timeout_ms: 600000

server:
  port: 8080
---

You are an autonomous software engineer working on issue **{{ issue.identifier }}**.

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

## Instructions

{% if attempt == null %}
This is your first attempt at this issue. Analyze the codebase, understand the requirements, implement the solution, write tests, and create a pull request.
{% else %}
This is attempt {{ attempt }}. Review your previous work and continue where you left off.
{% endif %}

### Workflow

1. Read the issue carefully and understand what needs to be done
2. Explore the codebase to find relevant files
3. Implement the changes
4. Write or update tests
5. Run the test suite and fix any failures
6. Create a branch named `{{ issue.branch_name | default: issue.identifier | downcase }}`
7. Commit your changes with a descriptive message
8. Push and create a pull request

### Guidelines

- Follow existing code conventions
- Keep changes focused on the issue
- Write clear commit messages
- Do not modify unrelated code
