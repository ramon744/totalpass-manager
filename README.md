# TotalPass Manager

Sistema web completo para gerenciamento de beneficiários TotalPass com integração Asaas (cobranças) e Uazapi (WhatsApp).

## Tecnologias

- **Next.js 16** — front-end React com App Router
- **Supabase** — banco de dados, autenticação e RLS
- **Tailwind CSS** — interface responsiva
- **PWA** — instalável no celular/desktop

## Funcionalidades

- Dashboard com métricas e gráficos
- Cadastro e hierarquia de beneficiários (titular/dependente)
- Importação de planilha Excel (sincronização cadastral)
- Integração Asaas (clientes, assinaturas, webhooks)
- Clientes pendentes de cobrança com anti-duplicidade
- Cobranças e assinaturas sincronizadas
- WhatsApp automático com templates editáveis
- Relatórios com exportação Excel/CSV
- Tema claro/escuro

## Configuração

### 1. Variáveis de ambiente

Copie `.env.local.example` para `.env.local` e preencha:

```env
NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua_chave_anon
SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key
CRON_SECRET=segredo_para_cron
ASAAS_WEBHOOK_TOKEN=token_webhook_asaas
```

### 2. Instalar e rodar

```bash
npm install
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000)

### 3. Criar usuário admin

No painel Supabase → Authentication → Users → Add user.

O trigger `on_auth_user_created` cria automaticamente o registro em `usuarios`.

Para definir como admin, atualize no SQL Editor:

```sql
UPDATE usuarios SET role = 'admin' WHERE email = 'seu@email.com';
```

### 4. Configurar Asaas

1. Em **Configurações**, informe API Key e ambiente
2. Configure webhook no Asaas apontando para:
   `https://yxwugamcufbhiicgwufd.supabase.co/functions/v1/asaas-webhook`
3. Eventos: PAYMENT_*, SUBSCRIPTION_*

### 5. Configurar Uazapi

Em **Configurações**, informe URL, Token e Instância.

### 6. Cron de lembretes WhatsApp

Configure um cron externo (Vercel Cron, GitHub Actions, etc.) para chamar diariamente:

```
POST https://seu-dominio.com/api/cron/reminders
Authorization: Bearer SEU_CRON_SECRET
```

## Importação de planilha

Colunas reconhecidas automaticamente:

- Nome, CPF, Telefone, Email
- Perfil/Tipo (Titular ou Dependente)
- Status, Plano
- **Aderido em** — apenas consulta, não gera cobranças

## Regras importantes

- Importação **não** cria assinaturas nem cobranças
- Anti-duplicidade: verificação no banco e no Asaas antes de criar assinatura
- Coluna "Aderido em" não define vencimentos

## Estrutura do banco

- `usuarios` — perfis e permissões
- `beneficiarios` — titulares e dependentes (via `titular_id`)
- `importacoes` — histórico de importações
- `assinaturas` — assinaturas recorrentes Asaas
- `cobrancas` — pagamentos sincronizados
- `mensagens` / `mensagem_templates` — fila WhatsApp
- `configuracoes` — settings do sistema
- `logs` — auditoria

## Deploy

Recomendado: Vercel + Supabase (projeto já configurado: **TotalPass**, região sa-east-1).

```bash
npm run build
npm start
```
