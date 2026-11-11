const commands = [
  'pkg update',
  'pkg install nodejs-lts git',
  'pkg install tur-repo x11-repo',
  'pkg install chromium',
  'git clone https://github.com/in3zalo-gk/aether-agent',
  'cd aether-agent',
  'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --omit=dev --workspace backend',
  'node scripts/setup.mjs',
  'cd backend',
  'node server.js'
];

console.log('Aether Agent — instalação no Termux');
console.log('Execute, nesta ordem:\n');
for (const command of commands) console.log(command);
console.log('\nDepois, abra backend/.local-token.txt e copie o token para o Aether.');
console.log('Alternativa explícita para exibir o token: node scripts/token.mjs');
console.log('Nunca envie o token nem sua chave da OpenRouter para outra pessoa.');
