# Máquina de Criativos v2.0 — Deploy Guide

## Novas funcionalidades
- ✅ Calendário editorial mensal gerado por IA com base no manual do cliente
- ✅ Publicação imediata no Instagram (feed único e carrossel)
- ✅ Agendamento automático de posts
- ✅ Upload de manual do cliente (PDF) para contextualizar o conteúdo
- ✅ Geração de 10 imagens em batch com GPT Image-1

---

## Variáveis de ambiente no Railway

As variáveis já existentes são mantidas. Apenas adicionar:

| Variável | Valor | Descrição |
|---|---|---|
| `PUBLIC_URL` | `https://criativos-saas.up.railway.app` | URL pública do Railway (já existe como `PUBLIC_URL`) |

> **Nota:** `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_ACCOUNT_ID_MARCA` e `INSTAGRAM_ACCOUNT_ID_PESSOAL` já estão configurados. O servidor usa:
> - `INSTAGRAM_ACCOUNT_ID_MARCA` → perfil `case` (Case Aceleradora)
> - `INSTAGRAM_ACCOUNT_ID_PESSOAL` → perfil `ana` (Ana Moutinho)
> - `INSTAGRAM_ACCESS_TOKEN` → token compartilhado para ambos os perfis

---

## Deploy

1. Copie `server.js`, `index.html` e `package.json` para o repo `criativos-saas`
2. Faça commit e push → Railway faz auto-deploy
3. Teste o health check: `GET /api/health`

```bash
git add server.js public/index.html package.json
git commit -m "feat: calendário editorial, publicação e agendamento IG, batch de imagens"
git push origin main
```

---

## Novos endpoints

### Manual do cliente
- `POST /api/manual/upload` — upload de PDF (form-data: `profile`, `manual`)
- `GET /api/manual/status/:profile` — verifica se manual existe

### Calendário
- `POST /api/calendar/generate` — gera calendário mensal
- `GET /api/calendar/:profile/:year/:month` — busca calendário salvo
- `PATCH /api/calendar/:profile/:year/:month/post/:postId` — atualiza status de post

### Instagram
- `POST /api/instagram/post` — publicação imediata (feed único)
- `POST /api/instagram/carousel` — publicação imediata (carrossel 2–10 slides)
- `POST /api/instagram/schedule` — agendamento de post
- `GET /api/instagram/scheduled` — lista posts agendados
- `DELETE /api/instagram/scheduled/:id` — cancela agendamento
- `GET /api/instagram/insights/:profile` — dados do perfil

### Upload de imagem
- `POST /api/upload-image` — hospeda imagem e retorna URL pública
