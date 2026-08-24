# Repository Instructions

## Graphify

- When the user types `/graphify`, use the installed graphify skill before doing anything else.

## Hackathon development workflow

- Treat `master` as protected. Never commit directly to it.
- Create or reuse one dedicated branch for each meaningful feature or milestone. Do not create a branch for every individual edit or commit.
- Keep all commits for that feature on the same branch until its pull request is complete.
- Implement and test each coherent increment before committing it with a descriptive conventional commit message.
- Push the feature branch and prepare a GitHub pull request for Qodo review.
- Address actionable Qodo findings on the same branch and pull request, then rerun relevant tests and push follow-up commits.
- Explain disputed or non-actionable findings in the pull request rather than silently ignoring them.
- Do not merge until required tests pass and Qodo findings are resolved or explicitly answered.
- Do not merge a pull request, delete its branch, or force-push unless the user explicitly asks for that action.
