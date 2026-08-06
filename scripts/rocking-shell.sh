# Rocking dev shell — paste into ~/.zshrc (or: source this file from it).
# Designed for SSH sessions from Termius/iPad, where the PATH is thinner and
# you can't see the repo state at a glance.
#
#   rocking        cd to the portal, print a situation report, start Claude Code
#   rocking .      same but don't launch Claude (just the report + a shell)
#
# Nothing here changes state: it never pulls, commits, or writes.

rocking() {
  # SSH shells often miss both of these.
  export PATH="/opt/homebrew/bin:$HOME/.local/bin:$PATH"

  local repo="$HOME/Documents/Claude/dashboard-v2"
  if [ ! -d "$repo" ]; then
    echo "✗ repo not found at $repo"
    return 1
  fi
  cd "$repo" || return 1

  local dim=$'\033[2m' bold=$'\033[1m' red=$'\033[31m' green=$'\033[32m' off=$'\033[0m'

  echo ""
  echo "${bold}Rocking portal${off} ${dim}$(pwd)${off}"
  echo "${dim}────────────────────────────────────────────────${off}"

  # Branch + how far ahead/behind the remote we are (no network calls).
  local branch ahead behind
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
  ahead=$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo "?")
  behind=$(git rev-list --count 'HEAD..@{u}' 2>/dev/null || echo "?")
  echo "branch   ${bold}${branch}${off}  ${dim}(${ahead} to push, ${behind} to pull — last fetch may be stale)${off}"

  # Uncommitted work, if any.
  local dirty
  dirty=$(git status --porcelain 2>/dev/null | grep -v '^??' | wc -l | tr -d ' ')
  if [ "$dirty" != "0" ]; then
    echo "${red}uncommitted${off} ${dirty} tracked file(s):"
    git status --short | grep -v '^??' | head -8 | sed 's/^/         /'
  else
    echo "working  ${green}clean${off} ${dim}(tracked files)${off}"
  fi

  echo ""
  echo "${dim}recent:${off}"
  git log --oneline -5 --format="  %C(dim)%ad%C(reset) %s" --date=format:'%d %b' 2>/dev/null

  # Nightly ingestion agents — did last night actually run?
  echo ""
  echo "${dim}nightly jobs (last run):${off}"
  local log
  for job in datto-pull m365-pull xero-pull security-normalize; do
    log="$HOME/Library/Logs/rocking-${job}.log"
    if [ -f "$log" ]; then
      printf "  %-20s %s\n" "$job" "$(date -r "$log" '+%d %b %H:%M')"
    else
      printf "  %-20s %s\n" "$job" "no log yet"
    fi
  done

  # Newest design docs = what we're currently thinking about.
  echo ""
  echo "${dim}latest specs:${off}"
  ls -t docs/superpowers/specs/ 2>/dev/null | head -3 | sed 's/^/  /'

  echo "${dim}────────────────────────────────────────────────${off}"
  echo "${dim}CLAUDE.md carries the standing context — Claude reads it itself.${off}"
  echo ""

  # `rocking .` = report only, no Claude.
  [ "$1" = "." ] && return 0

  command -v claude >/dev/null 2>&1 || { echo "✗ claude not on PATH"; return 1; }
  claude "$@"
}
