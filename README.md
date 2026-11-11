# Aether Agent

Agente pessoal **BYOK** (*Bring Your Own Key*) com frontend web, backend Cloudflare e automação local opcional. A interface foi reconstruída em React, Tailwind CSS e Framer Motion, com foco em celular, tema escuro e suporte a PWA.

**[Abrir Aether](https://aether-secure.pages.dev)** · **[Baixar APK Android 2.1.0](https://aether-secure.pages.dev/aether-agent.apk)** · **[Release Android](https://github.com/in3zalo-gk/aether-agent/releases/tag/v2.1.0-native-preview)**

> O frontend web e o aplicativo Android são artefatos separados. O APK é uma **prévia nativa 2.1.0**, não uma nova compilação da interface web. Instalação em aparelho, chave BYOK real e pagamento PIX ainda precisam de validação.

## O que mudou na interface

- Layout mobile-first com sidebar adaptável, histórico e pesquisa de conversas.
- Chat com estados de envio, execução, erro e cancelamento.
- Configurações em painel lateral animado, sem modal central.
- Modos **nuvem** e **local**, com indicação de disponibilidade do agente.
- Ferramentas com aprovação explícita e execução assíncrona.
- Manifesto, ícones e service worker para PWA. O cache guarda somente a interface pública, nunca API, mensagens ou chaves.
- Tratamento de falhas de rede sem derrubar a interface.
- Download do APK disponível na navegação do site.

## Como usar

### Nuvem

Abra o site, crie uma conta ou entre com usuário e senha. Guarde o código de recuperação fornecido ao criar a conta. Adicione um provedor e sua própria chave nas configurações, selecione o modelo e inicie uma conversa.

O Worker aceita protocolos OpenAI e Anthropic, mantém o histórico da conta e cifra as chaves armazenadas com AES-GCM, usando o segredo `KEY_ENCRYPTION_SECRET`. A memória é opcional. Chamadas ao provedor podem gerar custos na sua conta; não há créditos de IA incluídos.

### Agente local e Termux

O chat local usa um endpoint compatível com OpenAI. As configurações e a chave local ficam na memória da sessão; o histórico local fica nesta aba e não é enviado à nuvem do Aether. O backend local é opcional para renderizar a interface e para o chat em nuvem, mas necessário para executar comandos e controlar o Chromium via Termux.

Use Termux atualizado pelo F-Droid ou GitHub, Node.js 20.19+ e Git:

```sh
pkg update
pkg install nodejs-lts git
pkg install tur-repo x11-repo
pkg install chromium
git clone https://github.com/in3zalo-gk/aether-agent.git
cd aether-agent
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --omit=dev --workspace backend
node scripts/setup.mjs
cd backend
node server.js
```

Não execute `npx playwright install` no Android. O projeto tenta usar o Chromium do sistema; Playwright não oferece suporte oficial a Android/Termux. Os testes em Linux **não** comprovam funcionamento no telefone.

O setup é idempotente, gera o token local e grava `backend/.env` e `backend/.local-token.txt` com permissão `0600`, sem imprimir o segredo. O backend escuta apenas em `127.0.0.1:3000`. Nas configurações do site, informe `http://127.0.0.1:3000` e o token do backend. O token local **não é** a chave do provedor de IA.

Para consultar o token conscientemente no seu próprio terminal:

```sh
node scripts/token.mjs
```

Nunca compartilhe esse valor em mensagens, capturas, issues ou commits. O navegador pode exigir permissão de rede local para acessar localhost a partir do site HTTPS. `localhost` sempre se refere ao dispositivo em que o navegador está rodando.

## Android: download e integridade

- [APK no site](https://aether-secure.pages.dev/aether-agent.apk).
- [APK na release do GitHub](https://github.com/in3zalo-gk/aether-agent/releases/download/v2.1.0-native-preview/aether-agent-2.1.0-native-preview.apk).
- Cópia versionada: [`frontend/public/aether-agent.apk`](frontend/public/aether-agent.apk).
- Código Android: [`android/`](android/).

**Versão:** 2.1.0 native preview. **Tamanho:** 67.700 bytes.

SHA-256:

```text
a672b9685e3f1b397a47475a5b6b767c556ce9d453176ea7025effa4c1cc90f1
```

O APK não foi recompilado para esta publicação web. O hash identifica o artefato distribuído, não garante compatibilidade ou ausência de falhas. Acessibilidade e outras ações sensíveis devem ser habilitadas e aprovadas pelo usuário.

## Estrutura

| Diretório | Responsabilidade |
| --- | --- |
| `frontend/` | React, estilos, componentes, hooks, PWA e artefatos públicos. |
| `functions/api/` | Proxy Pages para o Worker, preservando a API na mesma origem. |
| `cloud/` | Worker, contas, autenticação, chat BYOK, armazenamento e PIX. |
| `backend/` | Servidor local autenticado, comandos e Chromium. |
| `android/` | Aplicativo Android nativo separado do frontend web. |
| `tests/` | Testes de backend, setup e navegador. |

O Pages usa `https://aether-secure.pages.dev`; o Worker configurado é `aether-agent-core`, em `https://aether-agent-core.taina-tvsm2021.workers.dev`. Não confunda este projeto com outro site Aether da conta.

## Desenvolvimento e testes

```sh
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci
npm run dev
npm run build
npm test
npm run test:browser
```

O Vite gera `frontend/dist` e encaminha `/api` em desenvolvimento para `http://127.0.0.1:8787`. Inicie o Worker separadamente para testar a nuvem em desenvolvimento. Para iniciar o backend local após o setup, use `npm start`.

Validações realizadas nesta reconstrução: build de produção; testes unitários frontend/cloud; testes Chromium de configuração local, aprovação/recusa de ferramentas, execução real de comando e navegador, continuidade, histórico, cancelamento, offline e tamanhos de 320 a 1440 px. As respostas do modelo no teste integrado são simuladas, sem chave de provedor real. Instalação PWA em aparelho, BYOK real e PIX não foram validados.

## Publicar no Cloudflare

```sh
npm run build
npm run deploy:pages
# Somente ao alterar o backend cloud:
npm run deploy:worker
```

Execute a publicação Pages na raiz do repositório para incluir `functions/`. Ela publica `frontend/dist` no projeto `aether-secure`, branch `main`. A cópia do APK em `frontend/public/` é incluída automaticamente no build.

Segredos devem ser configurados diretamente no Worker, nunca versionados:

```sh
wrangler secret put KEY_ENCRYPTION_SECRET --config cloud/wrangler.toml
wrangler secret put MP_ACCESS_TOKEN --config cloud/wrangler.toml
wrangler secret put MP_WEBHOOK_SECRET --config cloud/wrangler.toml
```

Os dois segredos Mercado Pago e a configuração do webhook são necessários para ativar PIX. Sem eles, o pagamento deve permanecer desativado. Uma confirmação visual do cliente não confirma pagamento: somente o servidor concede os benefícios de apoiador.

## Segurança e privacidade

- Use somente em dispositivos próprios e atividades autorizadas.
- Comandos de shell não são uma sandbox. Aprove apenas ações que você entende.
- Não publique chaves, tokens locais, senhas, cookies ou códigos de recuperação.
- Provedores de IA recebem o conteúdo necessário às solicitações, sob suas próprias políticas.
- O modo local envia a chave diretamente ao endpoint configurado; escolha um provedor confiável.
- Revogue a chave no provedor se suspeitar de exposição.
- Backend local indisponível não significa que o serviço em nuvem está indisponível.

## Licença

Copyright © 2026 Say. Todos os direitos reservados. Consulte [LICENSE](LICENSE). A disponibilidade pública do repositório não concede licença de uso ou redistribuição do código.
