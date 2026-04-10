<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Máquina de Criativos — Login</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Instrument+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  font-family: 'Instrument Sans', sans-serif;
  background: #f4f2ed;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
.login-card {
  background: #fff;
  border: 1px solid rgba(22,21,15,0.1);
  border-radius: 20px;
  padding: 48px 44px;
  width: 100%;
  max-width: 400px;
  text-align: center;
  box-shadow: 0 16px 48px rgba(22,21,15,0.08);
}
.logo {
  font-family: 'Syne', sans-serif;
  font-weight: 800;
  font-size: 22px;
  color: #16150f;
  letter-spacing: -0.5px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 8px;
}
.logo-dot { width:9px; height:9px; background:#e5470d; border-radius:50%; }
.subtitle { font-size: 13px; color: #6b6860; margin-bottom: 36px; }
.btn-google {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 100%;
  padding: 13px 20px;
  border: 1.5px solid rgba(22,21,15,0.15);
  border-radius: 10px;
  background: #fff;
  font-family: 'Instrument Sans', sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: #16150f;
  cursor: pointer;
  text-decoration: none;
  transition: all 0.15s;
}
.btn-google:hover {
  border-color: #16150f;
  background: #f4f2ed;
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(22,21,15,0.08);
}
.google-icon { width: 20px; height: 20px; flex-shrink: 0; }
.divider { height: 1px; background: rgba(22,21,15,0.08); margin: 28px 0; }
.footer-note { font-size: 11px; color: #a8a59e; line-height: 1.5; }
.error-msg {
  background: #fff5f2;
  border: 1px solid #fbd0c4;
  color: #c93a08;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 12px;
  margin-bottom: 20px;
  display: none;
}
.error-msg.visible { display: block; }
</style>
</head>
<body>
<div class="login-card">
  <div class="logo">
    <div class="logo-dot"></div>
    Máquina de Criativos
  </div>
  <div class="subtitle">Ferramenta interna de geração de criativos com IA</div>

  <div class="error-msg" id="errorMsg">
    Acesso não autorizado. Use uma conta Google cadastrada na plataforma.
  </div>

  <a href="/auth/google" class="btn-google">
    <svg class="google-icon" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
    Entrar com Google
  </a>

  <div class="divider"></div>
  <div class="footer-note">
    Acesso restrito. Apenas contas autorizadas podem entrar.<br>
    Entre em contato com o administrador para solicitar acesso.
  </div>
</div>

<script>
  if (window.location.search.includes('erro=nao-autorizado')) {
    document.getElementById('errorMsg').classList.add('visible');
  }
</script>
</body>
</html>
