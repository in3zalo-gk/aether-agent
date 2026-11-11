# Aether Agent

Backend local autenticado para o **Aether**, com interface publicada em [aether-secure.pages.dev](https://aether-secure.pages.dev). O site conversa apenas com um servidor que roda no seu dispositivo, em `127.0.0.1:3000`.

> O token local protege a API que executa comandos e controla o navegador. Ele **não é** a chave da OpenRouter.

## O que é necessário

- Android com **Termux atualizado**, instalado pelo [F-Droid](https://f-droid.org/packages/com.termux/) ou GitHub do projeto — não use a versão antiga da Play Store.
- Node.js 20.19 ou superior e Git.
- Chromium do repositório do Termux. O pacote fornece o executável `chromium-browser`.
- Conexão para instalar dependências e usar os serviços externos escolhidos.

O Playwright não oferece suporte oficial ao Android/Termux. O projeto inclui um ajuste de runtime para tentar usar o Chromium do sistema; trate-o como compatibilidade experimental, não como ambiente oficialmente testado.

## Instalação exata no Termux

Execute estes comandos, **nesta ordem**:

```sh
pkg update
pkg install nodejs-lts git
pkg install tur-repo x11-repo
pkg install chromium
git clone https://github.com/in3zalo-gk/aether-agent
cd aether-agent
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --omit=dev --workspace backend
node scripts/setup.mjs
cd backend
node server.js
```

Não rode `npx playwright install` no Android: ele tentaria baixar navegadores que não são necessários aqui. O `npm ci` acima usa o lockfile da raiz e instala apenas o workspace `backend`; o frontend já está publicado e não precisa ser instalado no telefone para o uso normal.

O setup é idempotente: na primeira execução ele gera `AETHER_LOCAL_TOKEN` criptográfico de 32 bytes em Base64URL; nas próximas, conserva o token e os valores já definidos no `backend/.env`. Ele também:

- grava `backend/.env` e `backend/.local-token.txt` com permissão `0600`;
- deixa o token fora do Git (`backend/.local-token.txt` já é ignorado);
- adiciona, quando ausentes, `ALLOWED_ORIGINS=https://aether-secure.pages.dev,http://localhost:5173,http://127.0.0.1:5173`, `PORT=3000` e `CHROMIUM_PATH` quando encontra o Chromium;
- nunca imprime o token durante o setup.

Para copiar o token, abra `backend/.local-token.txt`. Se você optar conscientemente por mostrá-lo no terminal, execute na raiz do projeto:

```sh
node scripts/token.mjs
```

Esse é o único script de documentação que mostra o segredo. Não cole o token em issues, commits, capturas de tela ou mensagens.

Também é possível imprimir o roteiro de instalação sem expor segredo:

```sh
node scripts/instructions.mjs
```

## Uso e rede local

O backend deve permanecer em execução dentro de `backend`:

```sh
node server.js
```

Ele carrega `.env` com o Node 20 e escuta somente em `127.0.0.1:3000`. Portanto, `localhost` no **mesmo telefone** funciona; um computador remoto não acessa o telefone por esse endereço.

Ao usar o site HTTPS publicado, Chrome/Chromium pode exibir um pedido para permitir acesso à rede local privada (PNA). Permita somente se o endereço for o site correto e o backend estiver rodando no seu próprio telefone. Dependendo da versão do navegador, pode ser necessário conceder a permissão de rede local ao Chrome/Chromium nas configurações do Android.

Se o navegador bloquear o acesso HTTPS → localhost, use o frontend local como alternativa:

```sh
# na raiz do projeto
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci
npm run dev
```

Abra o endereço indicado pelo Vite no mesmo dispositivo. Essa opção instala também as dependências do frontend. Em Termux/Android, compatibilidade de binários nativos do Vite/Rollup pode variar; se falhar, volte ao site publicado e verifique a permissão de rede local do navegador.

## OpenRouter (BYOK)

No Aether, escolha OpenRouter, configure a URL base `https://openrouter.ai/api/v1` e informe sua chave BYOK no campo próprio. A chave fica somente na memória por padrão. Apenas ao marcar **Guardar neste dispositivo** ela vai para o `localStorage`, sem criptografia; desmarcar remove a cópia salva. Para DeepSeek, escolha o provedor e confirme na sua conta um modelo compatível com ferramentas. O token local é outro campo: copie o valor gerado no Termux, mantenha o backend `http://127.0.0.1:3000` e confira o indicador conectado.

A chave da OpenRouter pode gerar cobrança conforme o modelo e sua conta. Não há garantia de que um modelo seja gratuito: escolha na interface um modelo disponível na sua conta que ofereça suporte a ferramentas. Revogue ou troque a chave no painel da OpenRouter se houver suspeita de exposição.

## Segurança operacional

- `AETHER_LOCAL_TOKEN` autentica o navegador para o backend; não substitui e não deve ser igual à chave da OpenRouter.
- O backend filtra variáveis com nomes sensíveis antes de executar comandos e restringe origens e host a localhost, mas comandos de shell ainda são poderosos.
- Use somente em seus próprios dispositivos e em atividades autorizadas. Prompts de red team devem ser autorizados e não devem pedir para ignorar ética, políticas ou controles de segurança.
- O shell não é uma sandbox. No Termux ele usa o UID do app; não pressupõe `su` nem permissões root.

## Desenvolvimento e testes

Na raiz, os comandos disponíveis incluem:

```sh
npm run setup
npm start
npm run build
npm test
```

`npm start` também inicia o backend com `node --env-file=backend/.env backend/server.js`. Para desenvolvimento local do frontend, `npm run dev` usa `127.0.0.1` como fallback para reduzir problemas de PNA. Execute os testes no ambiente em que pretende fazer alterações; não trate resultados de Linux como validação do Chromium no Termux.

## Publicar o frontend no Cloudflare Pages

A publicação do frontend não publica o backend nem segredos. Com acesso à conta Cloudflare:

```sh
npm install -g wrangler
npm run build
wrangler pages project create aether-secure --production-branch main
wrangler pages deploy frontend/dist --project-name aether-secure --branch main
```

O destino esperado é `https://aether-secure.pages.dev`. Confira o domínio configurado no projeto e mantenha `https://aether-secure.pages.dev` na lista `ALLOWED_ORIGINS` do backend.

## Criar uma cópia no GitHub (opcional)

Se for publicar sua própria cópia, autentique o GitHub CLI e crie o repositório a partir da raiz do projeto:

```sh
gh auth login
gh repo create aether-agent --public --source=. --remote=origin --push
```

Revise `git status` antes do push e confirme que `backend/.env` e `backend/.local-token.txt` não aparecem. Não inclua chaves, tokens ou arquivos locais no repositório.

Nenhuma licença é adicionada automaticamente por esta documentação.
