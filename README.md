# Controle de Chips das Remotas

App web para controlar os chips das remotas de telemetria do Grupo A: entrada no estoque, saída para equipe, instalação, remanejamento, retirada, devolução, transferência entre regionais, devolução à operadora e baixa. Mostra painéis, estoque físico por regional e relatórios para a chefia.

- Funciona no **computador** (navegador) e no **celular**, onde pode ser **instalado como app** na tela inicial.
- Todos os usuários veem os **mesmos dados em tempo real**.
- Cada pessoa entra com **e-mail e senha**. Quem pede acesso fica pendente até um administrador liberar.
- No celular, **funciona sem sinal**: o que for registrado fica guardado no aparelho e é enviado quando a internet voltar.

---

## Como funciona

| Parte | O que é | Custo |
|---|---|---|
| **GitHub Pages** | Hospeda o app (os arquivos deste repositório) num endereço como `https://SEU-USUARIO.github.io/controle-chips-remotas/` | Gratuito |
| **Firebase** (Google) | Guarda os dados (Firestore) e faz o login (Authentication) | Gratuito no plano Spark para este volume de uso |

Os dados **não** ficam no GitHub. O repositório tem só o código. Sem login liberado, ninguém lê nem grava nada.

---

## Estrutura do repositório

```
controle-chips-remotas/
├── index.html              Tela do app (login, painel, abas, formulários)
├── manifest.webmanifest    Permite instalar no celular como app
├── sw.js                   Faz o app abrir mesmo sem internet
├── firestore.rules         Regras de segurança do banco (colar no Firebase)
├── css/
│   └── app.css             Visual do app, incluindo o layout de celular
├── js/
│   ├── config.js           ⚙️ ÚNICO arquivo que você precisa editar
│   ├── app.js              Lógica do app (telas, gráficos, relatórios)
│   └── store.js            Conexão com o Firebase (login e banco)
├── vendor/
│   └── chart.umd.min.js    Biblioteca dos gráficos (Chart.js 4.4.1, licença MIT)
└── assets/
    ├── icons/              Ícones do app instalado
    └── logos/              Logos da Equatorial e das operadoras
```

---

## Passo a passo da instalação (uma vez só, cerca de 30 minutos)

### 1. Criar o projeto no Firebase

1. Acesse <https://console.firebase.google.com> com uma conta Google.
2. Clique em **Adicionar projeto**. Sugestão de nome: `controle-chips-remotas`. O Google Analytics pode ficar desativado.
3. No menu da esquerda, abra **Criação → Authentication → Vamos começar**.
   - Em **Método de login**, ative **E-mail/senha** e salve.
4. Abra **Criação → Firestore Database → Criar banco de dados**.
   - Local: **southamerica-east1 (São Paulo)**.
   - Modo: **produção**.
5. Ainda no Firestore, abra a aba **Regras**, apague tudo, cole o conteúdo do arquivo [`firestore.rules`](firestore.rules) e clique em **Publicar**.

### 2. Ligar o app ao Firebase

1. No Firebase, clique na engrenagem **⚙️ → Configurações do projeto**.
2. Em **Seus apps**, clique no ícone **`</>`** (Web). Nome: `Controle de Chips`. Não marque Hosting. Clique em **Registrar app**.
3. Aparece um bloco `const firebaseConfig = { ... }`. Copie só o que está entre as chaves.
4. Abra [`js/config.js`](js/config.js) e troque `firebase: null,` por:

```js
firebase: {
  apiKey: "…",
  authDomain: "….firebaseapp.com",
  projectId: "…",
  storageBucket: "….appspot.com",
  messagingSenderId: "…",
  appId: "…"
},
```

> A `apiKey` do Firebase não é uma senha. Ela identifica o projeto e pode ficar no repositório. Quem protege os dados são o login e as regras do passo 1.5.

### 3. Publicar no GitHub Pages

1. Crie um repositório no GitHub chamado `controle-chips-remotas`.
   - O GitHub Pages gratuito exige repositório **público**. Isso expõe só o código, não os dados.
2. Envie todos os arquivos desta pasta para o repositório. Pelo navegador: **Add file → Upload files**, arraste o conteúdo da pasta e clique em **Commit changes**.
3. No repositório, abra **Settings → Pages**.
   - Em **Source**, escolha **Deploy from a branch**.
   - Em **Branch**, escolha **main** e **/ (root)**. Salve.
4. Depois de 1 ou 2 minutos, o endereço aparece no topo da página. Exemplo: `https://seu-usuario.github.io/controle-chips-remotas/`.

### 4. Autorizar o endereço no Firebase

1. No Firebase, abra **Authentication → Configurações → Domínios autorizados**.
2. Clique em **Adicionar domínio** e informe `seu-usuario.github.io`, sem `https://` e sem barra.

### 5. Criar o primeiro administrador

1. Abra o endereço do app e clique em **Não tenho acesso — pedir cadastro**. Preencha nome, e-mail e senha.
2. O app mostra "Cadastro recebido".
3. No Firebase, abra **Firestore Database → Dados → coleção `usuarios`** e clique no documento com o seu e-mail.
4. Troque o campo `papel` de `pendente` para `admin` e salve.
5. O app abre sozinho. A partir de agora, os outros usuários são liberados **pelo próprio app**, na aba **Usuários**.

---

## Níveis de acesso

| Acesso | O que pode fazer |
|---|---|
| **Administrador** | Tudo: registrar movimentações, editar chips, liberar e bloquear usuários |
| **Leitor** | Ver painel, estoque, chips, movimentações e relatórios, e exportar CSV. Ideal para a chefia |
| **Pendente** | Pediu cadastro e aguarda liberação |
| **Bloqueado** | Não entra no app |

As movimentações registradas **não podem ser alteradas nem apagadas** por ninguém, nem por administradores. Isso garante o histórico para auditoria. Se algo foi lançado errado, registre uma nova movimentação corrigindo a situação. Se for preciso, marque "Ignorar validação de situação" no formulário.

---

## Instalar no celular

**Android (Chrome)**
1. Abra o endereço do app no Chrome.
2. Toque em **Instalar app**, no topo do app, ou no menu **⋮ → Instalar app / Adicionar à tela inicial**.

**iPhone (Safari)**
1. Abra o endereço no **Safari**. Precisa ser o Safari.
2. Toque em **Compartilhar** (quadrado com seta) **→ Adicionar à Tela de Início**.

O ícone "Chips Remotas" aparece na tela inicial e o app abre em tela cheia. No celular, a tela muda:
- as abas ficam num menu na parte de baixo;
- o botão **+** abre uma nova movimentação;
- os filtros ficam recolhidos no botão **Filtros**;
- as tabelas viram cartões, fáceis de ler na tela pequena.

---

## Uso no dia a dia

- **Filtro do topo** (regional, operadora e período): muda tudo de uma vez. Painel, gráficos, estoque, tabelas, resumo e CSV passam a mostrar só o que foi escolhido.
- **Painel**: toque numa fatia ou barra dos gráficos para detalhar ou filtrar.
- **Estoque**: um cartão por regional com o estoque físico. Toque no cartão para ver só aquela regional.
- **Chips**: busca por ICCID, linha, UC, remota, cidade ou equipe. Toque no chip para ver o histórico completo e registrar a próxima ação.
- **Relatórios**: gráficos, a tabela de locais com problema de sinal, o botão **Copiar resumo** (pronto para e-mail ou WhatsApp) e a exportação **CSV** (abre no Excel).
- **Entrada em lote**: no formulário, cole vários ICCIDs, um por linha. Também aceita `ICCID;linha;operadora`, copiado do Excel.

---

## Manutenção

**Incluir uma regional ou cidade:** edite a lista `regionais` em `js/config.js`. Nunca troque o `id` de uma regional que já tenha chips cadastrados.

**Incluir uma operadora:** coloque o logo em PNG em `assets/logos/` e acrescente uma linha na lista `operadoras` em `js/config.js`.

**Publicar uma versão nova:**
1. Envie os arquivos alterados para o GitHub.
2. Em `sw.js`, aumente o número em `VERSAO` (por exemplo, `chips-remotas-v2`). Assim os celulares baixam a versão nova.
3. Os aparelhos atualizam na próxima vez que o app for aberto com internet.

**Cópia de segurança:**
- Use **Relatórios → Exportar** para gerar os CSV de movimentações e do cadastro de chips.
- Para cópia completa do banco, use **Firestore → Importar/Exportar** no Console do Google Cloud. Isso exige o plano Blaze.

**Testar no computador sem Firebase:**
- Deixe `firebase: null` em `js/config.js`. O app roda em **modo local**: sem login, com os dados só naquele navegador.
- Os arquivos precisam ser abertos por um servidor, porque o duplo clique no `index.html` não funciona. Na pasta do projeto, rode `python -m http.server 8000` e abra `http://localhost:8000`.
- O botão **Ver painel com dados de exemplo** preenche tudo com dados fictícios, que não são salvos.

---

## Limites do plano gratuito do Firebase (Spark)

| Recurso | Limite gratuito |
|---|---|
| Armazenamento | 1 GiB |
| Leituras | 50 mil por dia |
| Gravações | 20 mil por dia |

Para alguns milhares de chips e algumas dezenas de usuários, isso é bem mais que o necessário.

---

## Observação importante

Antes de colocar dados reais da empresa, confirme com a TI/Segurança da Informação se é permitido usar GitHub e Firebase (Google Cloud) para esse controle. Se não for, o mesmo código pode ser hospedado num servidor interno. Para isso, basta trocar `js/store.js` por uma conexão com o banco da empresa.
