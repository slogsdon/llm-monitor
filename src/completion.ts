const PROVIDERS = 'litellm llamaswap mlx ollama';
const WORDS =
  'monitor report providers history completion --interval --json --markdown --quiet --provider --model --watch --config --help --version';

const BASH = `_llm_monitor() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local prev="\${COMP_WORDS[COMP_CWORD-1]}"
  case "$prev" in
    --provider|-p) COMPREPLY=($(compgen -W "${PROVIDERS}" -- "$cur")); return;;
    --config|-c) COMPREPLY=($(compgen -f -- "$cur")); return;;
    completion) COMPREPLY=($(compgen -W "bash zsh" -- "$cur")); return;;
  esac
  COMPREPLY=($(compgen -W "${WORDS}" -- "$cur"))
}
complete -F _llm_monitor llm-monitor
`;

const ZSH = `_llm_monitor() {
  local -a commands
  commands=(
    'monitor:live dashboard (default)'
    'report:point-in-time snapshot'
    'providers:list detected providers'
    'history:60s tok/s sparklines per model'
    'completion:print shell completion script'
  )
  _arguments -C \\
    '(-i --interval)'{-i,--interval}'[refresh interval in seconds]:seconds' \\
    '--json[emit JSON]' \\
    '--markdown[emit Markdown]' \\
    '(-q --quiet)'{-q,--quiet}'[data only, no headers]' \\
    '(-p --provider)'{-p,--provider}'[scope to providers]:provider:(${PROVIDERS})' \\
    '(-m --model)'{-m,--model}'[filter models by substring]:model' \\
    '(-w --watch)'{-w,--watch}'[dashboard for one model]:model' \\
    '(-c --config)'{-c,--config}'[LiteLLM config path]:file:_files' \\
    '1:command:->cmd' '*::arg:->args'
  case $state in
    cmd) _describe 'command' commands;;
    args) [[ $words[1] == completion ]] && _values shell bash zsh;;
  esac
}
compdef _llm_monitor llm-monitor
`;

export function completionScript(shell: string): string {
  if (shell === 'bash') return BASH;
  if (shell === 'zsh') return ZSH;
  throw new Error(`unsupported shell "${shell}" (bash, zsh)`);
}
