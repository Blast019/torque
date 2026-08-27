// Helper comum de configuração para os scripts de QA da Fase 2.5.
//
// Lê EXCLUSIVAMENTE process.env - nenhuma credencial fica hardcoded aqui nem
// em nenhum outro script. Valida que todas as variáveis obrigatórias estão
// definidas antes de qualquer script prosseguir, e encerra com mensagem clara
// (sem nunca imprimir o valor de senha, chave ou token) se faltar alguma.
//
// Uso, a partir da raiz do repositório:
//   node --env-file=qa/.env qa/fase-2.5/scripts/NOME_DO_SCRIPT.js
//
// Ver qa/.env.example para a lista de variáveis e criar seu qa/.env local
// (ignorado pelo Git - ver .gitignore na raiz).

const OBRIGATORIAS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_TEST_PASSWORD',
  'QA_EMAIL_PROPRIETARIO',
  'QA_EMAIL_ADMIN',
  'QA_EMAIL_USUARIO',
  'QA_EMAIL_SEM_VINCULO',
  'QA_EMAIL_PROPRIETARIO_ANTIGO',
];

const faltando = OBRIGATORIAS.filter((nome) => !process.env[nome]);
if (faltando.length > 0) {
  console.error('Variáveis de ambiente obrigatórias ausentes:', faltando.join(', '));
  console.error('Configure qa/.env (copie de qa/.env.example) e rode com:');
  console.error('  node --env-file=qa/.env qa/fase-2.5/scripts/<script>.js');
  process.exit(1);
}

module.exports = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SENHA_QA: process.env.SUPABASE_TEST_PASSWORD,
  EMAIL_PROPRIETARIO: process.env.QA_EMAIL_PROPRIETARIO,
  EMAIL_ADMIN: process.env.QA_EMAIL_ADMIN,
  EMAIL_USUARIO: process.env.QA_EMAIL_USUARIO,
  EMAIL_SEM_VINCULO: process.env.QA_EMAIL_SEM_VINCULO,
  EMAIL_PROPRIETARIO_ANTIGO: process.env.QA_EMAIL_PROPRIETARIO_ANTIGO,
};
