const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const DIAS_AGUARDANDO_RETORNO = 5;
const LIMITE_AVISOS = 3;

let empresaId = null;
let empresaNome = 'a oficina';
let contextoEmpresa = null;
let vinculosAtivosAtual = [];
let inicializandoApp = false;
let data = { clientes: [], veiculos: [], pecas: [], fornecedores: [], os: [], osItens: [], movimentos: [], marcas: [], modelos: [], funcionarios: [] };
let filtroFuncionarios = '';
let modoCadastro = false;
let filtroClientes = '';
let filtroStatusCliente = '';
let filtroPecas = '';
let filtroFornecedores = '';
let filtroOS = '';
let filtroPagoOS = '';
let filtroStatusOS = '';
let filtroDataOS = '';
let colunasExpandidas = {};
let painelPaginas = { fila: 1, aguardando: 1, semRetorno: 1 };
const PAINEL_PAGE_SIZE = 5;
let osItensAtual = [];
let financeiroCursor = new Date();
let filtroTipoMovimento = '';
let filtroCategoriaMovimento = '';
let usuariosEmpresaCarregados = false;
let usuariosEmpresaCarregando = false;
let adicionandoUsuarioEmpresa = false;
let usuariosEmpresaListaAtual = [];
let vinculoIdParaRemover = null;
let removendoUsuarioEmpresa = false;
let vinculoIdParaReativar = null;

// ---------------- AUTH ----------------
function alternarModoAuth(){
  modoCadastro = !modoCadastro;
  document.getElementById('authTitle').textContent = modoCadastro ? 'Criar conta' : 'Entrar';
  document.getElementById('authSub').textContent = modoCadastro ? 'Cadastre sua oficina no Torque' : 'Acesse o painel da sua oficina';
  document.getElementById('authNomeField').classList.toggle('hidden', !modoCadastro);
  document.getElementById('authCnpjField').classList.toggle('hidden', !modoCadastro);
  document.getElementById('authTelefoneField').classList.toggle('hidden', !modoCadastro);
  document.getElementById('authSubmitBtn').textContent = modoCadastro ? 'Criar conta' : 'Entrar';
  document.getElementById('authToggle').innerHTML = modoCadastro
    ? 'Já tem conta? <a id="authToggleLink2">Entrar</a>'
    : 'Ainda não tem conta? <a id="authToggleLink">Criar conta</a>';
  // O innerHTML acima destrói o link anterior e cria um novo — reanexar a
  // mesma função ao link recém-criado, em vez de tentar clicar num nó que
  // já não existe mais (causa do TypeError anterior).
  const novoLink = document.getElementById(modoCadastro ? 'authToggleLink2' : 'authToggleLink');
  if(novoLink) novoLink.addEventListener('click', alternarModoAuth);
}
document.getElementById('authToggleLink').addEventListener('click', alternarModoAuth);

document.getElementById('authSubmitBtn').addEventListener('click', async ()=>{
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const nomeOficina = document.getElementById('authNomeOficina').value.trim();
  const cnpjOficina = document.getElementById('authCnpj').value.trim();
  const telefoneOficina = document.getElementById('authTelefone').value.trim();
  const errEl = document.getElementById('authError');
  errEl.classList.add('hidden');

  if(!email || !password){ showAuthError('Preencha e-mail e senha.'); return; }

  if(modoCadastro){
    // A criação da empresa não acontece mais aqui: signUp só grava os dados
    // como "pendentes" em user_metadata. A criação real (empresa + vínculo
    // proprietario) é feita pela RPC criar_empresa_com_vinculo, chamada por
    // iniciarApp() assim que existir uma sessão autenticada de verdade
    // (logo abaixo, ou no primeiro login pós-confirmação de e-mail).
    const { data: signData, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: {
          pending_empresa: true,
          pending_empresa_nome: nomeOficina || 'Minha oficina',
          pending_empresa_cnpj: cnpjOficina || null,
          pending_empresa_telefone: telefoneOficina || null
        }
      }
    });
    if(error){ showAuthError(error.message); return; }
    if(!signData.session){
      showAuthError('Conta criada! Verifique seu e-mail para confirmar antes de entrar.');
      return;
    }
    await iniciarApp();
  } else {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if(error){ showAuthError(error.message); return; }
    await iniciarApp();
  }
});

function showAuthError(msg){
  const el = document.getElementById('authError');
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function sairDaConta(){
  // Não apaga nenhuma chave do localStorage: a última empresa escolhida
  // (torque_empresa_ativa:{usuarioId}) fica preservada para restaurar a
  // escolha no próximo login dessa mesma conta.
  await sb.auth.signOut();
  location.reload();
}

document.getElementById('logoutBtn').addEventListener('click', sairDaConta);

document.getElementById('trocarEmpresaBtn').addEventListener('click', ()=>{
  if(!contextoEmpresa || vinculosAtivosAtual.length <= 1) return;
  // Reusa a lista de vínculos já carregada no boot — não repete a consulta.
  mostrarSeletorEmpresa(vinculosAtivosAtual, (vinculoEscolhido)=>{
    persistirEscolhaERecarregar(contextoEmpresa.usuarioId, vinculoEscolhido.empresa_id);
  });
});

async function checkSessaoExistente(){
  const { data: { session } } = await sb.auth.getSession();
  if(session) await iniciarApp();
}

// ---------------- CONTEXTO DA EMPRESA (Fase 3) ----------------

const TELAS_PRINCIPAIS = ['authScreen', 'estadoContextoScreen', 'seletorEmpresaScreen', 'appScreen'];
function mostrarTela(id){
  TELAS_PRINCIPAIS.forEach(t => document.getElementById(t).classList.toggle('hidden', t !== id));
}

// Estado genérico (resolvendo, erro técnico, sem vínculo, finalizando
// cadastro, conta inconsistente, criação não permitida) — reduz duplicação
// entre esses 6 estados, que só diferem em título/mensagem/ações.
function mostrarEstadoContexto({ titulo, mensagem, acoes = [] }){
  document.getElementById('estadoContextoTitulo').textContent = titulo;
  document.getElementById('estadoContextoMensagem').textContent = mensagem;
  const container = document.getElementById('estadoContextoAcoes');
  container.replaceChildren();
  acoes.forEach(acao=>{
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = acao.primary ? 'btn btn-primary' : 'btn';
    btn.textContent = acao.label;
    btn.addEventListener('click', acao.onClick);
    container.appendChild(btn);
  });
  mostrarTela('estadoContextoScreen');
}

function mostrarSeletorEmpresa(vinculos, onEscolher){
  const lista = document.getElementById('seletorEmpresaLista');
  lista.replaceChildren();
  vinculos.forEach(vinculo=>{
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'seletor-empresa-item';
    const nomeEl = document.createElement('span');
    nomeEl.className = 'seletor-empresa-nome';
    nomeEl.textContent = vinculo.empresa.nome;
    const papelEl = document.createElement('span');
    papelEl.className = 'seletor-empresa-papel';
    papelEl.textContent = vinculo.papel;
    btn.appendChild(nomeEl);
    btn.appendChild(papelEl);
    btn.addEventListener('click', ()=>onEscolher(vinculo));
    lista.appendChild(btn);
  });
  mostrarTela('seletorEmpresaScreen');
}

function chaveEmpresaAtiva(usuarioId){
  return 'torque_empresa_ativa:' + usuarioId;
}

function persistirEscolha(usuarioId, empresaIdEscolhida){
  localStorage.setItem(chaveEmpresaAtiva(usuarioId), empresaIdEscolhida);
}

function persistirEscolhaERecarregar(usuarioId, empresaIdEscolhida){
  persistirEscolha(usuarioId, empresaIdEscolhida);
  location.reload();
}

// Nunca confia direto no valor salvo: só aceita se corresponder a um dos
// vínculos ativos já carregados neste boot. Se não corresponder mais
// (vínculo desativado, por exemplo), remove a entrada e devolve null.
function validarEscolhaSalva(usuarioId, vinculosAtivos){
  const chave = chaveEmpresaAtiva(usuarioId);
  const empresaIdSalva = localStorage.getItem(chave);
  if(!empresaIdSalva) return null;
  const vinculoCorrespondente = vinculosAtivos.find(v => v.empresa_id === empresaIdSalva);
  if(vinculoCorrespondente) return vinculoCorrespondente;
  localStorage.removeItem(chave);
  return null;
}

// Só vínculos ativos (usuarios_empresas.ativo = true), via
// usuarios_empresas.usuario_id (nunca user_id) — nunca consulta
// empresas.owner_id, nunca usa limit(1).
async function buscarVinculosAtivos(usuarioId){
  const { data, error } = await sb
    .from('usuarios_empresas')
    .select(`
      id,
      empresa_id,
      usuario_id,
      papel,
      empresa:empresas!usuarios_empresas_empresa_id_fkey(
        id,
        nome,
        cnpj,
        telefone,
        plano,
        status_assinatura
      )
    `)
    .eq('usuario_id', usuarioId)
    .eq('ativo', true);

  if(error) throw error;

  const vinculos = data || [];
  const vinculoSemEmpresa = vinculos.find(v => !v.empresa || !v.empresa.id);
  if(vinculoSemEmpresa){
    throw new Error('Vinculo sem dados de empresa retornados (usuarios_empresas.id=' + vinculoSemEmpresa.id + ').');
  }
  return vinculos;
}

function montarContexto(vinculo){
  return {
    empresaId: vinculo.empresa.id,
    empresaNome: vinculo.empresa.nome,
    empresaCnpj: vinculo.empresa.cnpj,
    empresaTelefone: vinculo.empresa.telefone,
    empresaPlano: vinculo.empresa.plano,
    empresaStatusAssinatura: vinculo.empresa.status_assinatura,
    papel: vinculo.papel,
    vinculoId: vinculo.id,
    usuarioId: vinculo.usuario_id
  };
}

async function entrarNaEmpresa(vinculo){
  contextoEmpresa = montarContexto(vinculo);

  // Defensivo: mesmo a troca de empresa hoje sempre passando por um reload
  // completo da página (persistirEscolhaERecarregar()), que já zeraria esse
  // estado sozinho, esta função é o único ponto de entrada do contexto de
  // uma empresa — reseta explicitamente aqui para não depender
  // implicitamente do reload como garantia de correção. Evita que dados ou
  // filtros da empresa anterior apareçam, mesmo momentaneamente.
  usuariosEmpresaListaAtual = [];
  usuariosEmpresaCarregados = false;
  document.getElementById('usuariosEmpresaBuscaEmail').value = '';
  document.getElementById('usuariosEmpresaFiltroStatus').value = 'ativos';
  document.getElementById('usuariosEmpresaFiltroPapel').value = '';

  // empresaId/empresaNome mantidas só por compatibilidade com o restante do
  // script (que já usa essas duas variáveis em ~17 pontos) — sempre
  // atribuídas a partir de contextoEmpresa, nunca em outro lugar.
  empresaId = contextoEmpresa.empresaId;
  empresaNome = contextoEmpresa.empresaNome || 'a oficina';

  document.getElementById('empresaNomeLabel').textContent = contextoEmpresa.empresaNome;
  document.getElementById('oficinaNome').value = contextoEmpresa.empresaNome || '';
  document.getElementById('oficinaCnpj').value = contextoEmpresa.empresaCnpj || '';
  document.getElementById('oficinaTelefone').value = contextoEmpresa.empresaTelefone || '';
  document.getElementById('oficinaPlanoLabel').textContent = contextoEmpresa.empresaPlano || 'Teste';
  const statusPlano = contextoEmpresa.empresaStatusAssinatura || 'ativo';
  const statusLabels = { ativo: 'Ativo', inadimplente: 'Inadimplente', cancelado: 'Cancelado' };
  const statusSpan = document.createElement('span');
  statusSpan.className = 'tag-pill';
  statusSpan.textContent = statusLabels[statusPlano] || statusPlano;
  document.getElementById('oficinaStatusLabel').replaceChildren(statusSpan);

  document.getElementById('trocarEmpresaBtn').classList.toggle('hidden', vinculosAtivosAtual.length <= 1);
  document.getElementById('novaEmpresaConfigBtn').classList.toggle('hidden', contextoEmpresa.papel !== 'proprietario');
  renderMinhasEmpresas();

  mostrarTela('appScreen');

  try{
    await carregarMarcasModelos();
    await carregarDados();
  } catch(erro){
    // Falha aqui é um problema técnico de carregamento, não "sem vínculo" —
    // o contexto da empresa já está resolvido e válido neste ponto.
    mostrarEstadoContexto({
      titulo: 'Erro ao carregar dados',
      mensagem: 'Não foi possível carregar os dados da empresa. Tente novamente.',
      acoes: [{ label: 'Tentar novamente', primary: true, onClick: ()=>location.reload() }]
    });
  }
}

function mostrarErroRpcCadastro(erro){
  const codigo = erro && erro.code;
  if(codigo === 'TRQ01'){
    mostrarEstadoContexto({
      titulo: 'Sessão inválida',
      mensagem: 'Sua sessão não é válida para concluir o cadastro. Entre novamente.',
      acoes: [{ label: 'Sair', primary: true, onClick: sairDaConta }]
    });
    return;
  }
  if(codigo === 'TRQ02'){
    mostrarEstadoContexto({
      titulo: 'Conta inconsistente',
      mensagem: 'Há uma inconsistência na sua conta. Entre em contato com o suporte.',
      acoes: [{ label: 'Sair', onClick: sairDaConta }]
    });
    return;
  }
  if(codigo === 'TRQ03'){
    mostrarEstadoContexto({
      titulo: 'Criação não permitida',
      mensagem: 'Sua conta já tem acesso a uma empresa. Atualize a página para continuar.',
      acoes: [{ label: 'Atualizar', primary: true, onClick: ()=>location.reload() }]
    });
    return;
  }
  if(codigo === 'TRQ04'){
    mostrarEstadoContexto({
      titulo: 'Dados inválidos',
      mensagem: 'Os dados informados no cadastro são inválidos. Entre em contato com o suporte.',
      acoes: [{ label: 'Sair', onClick: sairDaConta }]
    });
    return;
  }
  mostrarEstadoContexto({
    titulo: 'Erro técnico',
    mensagem: 'Não foi possível concluir o cadastro da empresa. Tente novamente.',
    acoes: [
      { label: 'Tentar novamente', primary: true, onClick: ()=>iniciarApp() },
      { label: 'Sair', onClick: sairDaConta }
    ]
  });
}

// 0 vínculos + pending_empresa === true: só chega aqui depois que
// buscarVinculosAtivos() já confirmou 0 vínculos nesta mesma consulta do
// boot atual. Os valores de user_metadata são só carga útil da RPC — quem
// autoriza (ou não) a criação é a própria função, no banco.
async function finalizarCadastroPendente(user){
  mostrarEstadoContexto({
    titulo: 'Finalizando cadastro',
    mensagem: 'Estamos concluindo o cadastro da sua empresa…',
    acoes: []
  });

  const metadata = user.user_metadata || {};
  const { data: resultadoRpc, error } = await sb.rpc('criar_empresa_com_vinculo', {
    p_nome_empresa: metadata.pending_empresa_nome || null,
    p_cnpj_empresa: metadata.pending_empresa_cnpj || null,
    p_telefone_empresa: metadata.pending_empresa_telefone || null
  });

  if(error){
    mostrarErroRpcCadastro(error);
    return;
  }

  const resultado = Array.isArray(resultadoRpc) ? resultadoRpc[0] : resultadoRpc;
  if(!resultado || !resultado.empresa_id){
    mostrarEstadoContexto({
      titulo: 'Erro técnico',
      mensagem: 'A criação da empresa não retornou os dados esperados. Tente novamente.',
      acoes: [
        { label: 'Tentar novamente', primary: true, onClick: ()=>iniciarApp() },
        { label: 'Sair', onClick: sairDaConta }
      ]
    });
    return;
  }

  // Limpeza best-effort do metadata pendente. Se falhar, NÃO desfaz o
  // cadastro (empresa e vínculo já foram criados pela RPC) e não provoca
  // uma nova empresa em retries futuros: a partir daqui o usuário sempre
  // terá >=1 vínculo ativo, então iniciarApp() nunca mais entra neste ramo
  // de "0 vínculos + pending_empresa", independentemente do metadata.
  try{
    await sb.auth.updateUser({
      data: {
        pending_empresa: false,
        pending_empresa_nome: null,
        pending_empresa_cnpj: null,
        pending_empresa_telefone: null
      }
    });
  } catch(erroLimpeza){
    // best-effort — sem ação adicional.
  }

  persistirEscolhaERecarregar(user.id, resultado.empresa_id);
}

async function iniciarApp(){
  if(inicializandoApp) return;
  inicializandoApp = true;
  try{
    mostrarEstadoContexto({
      titulo: 'Carregando',
      mensagem: 'Resolvendo o contexto da sua empresa…',
      acoes: []
    });

    let user;
    try{
      const { data: userData, error: erroUsuario } = await sb.auth.getUser();
      if(erroUsuario) throw erroUsuario;
      user = userData.user;
    } catch(erro){
      mostrarEstadoContexto({
        titulo: 'Erro técnico',
        mensagem: 'Não foi possível confirmar sua sessão. Tente novamente.',
        acoes: [
          { label: 'Tentar novamente', primary: true, onClick: ()=>iniciarApp() },
          { label: 'Sair', onClick: sairDaConta }
        ]
      });
      return;
    }
    if(!user){
      mostrarTela('authScreen');
      return;
    }

    let vinculos;
    try{
      vinculos = await buscarVinculosAtivos(user.id);
    } catch(erro){
      mostrarEstadoContexto({
        titulo: 'Erro técnico',
        mensagem: 'Não foi possível carregar os vínculos da sua conta. Tente novamente.',
        acoes: [
          { label: 'Tentar novamente', primary: true, onClick: ()=>iniciarApp() },
          { label: 'Sair', onClick: sairDaConta }
        ]
      });
      return;
    }

    vinculosAtivosAtual = vinculos;
    usuarioIdAtual = user.id;

    if(vinculos.length === 0){
      const pendente = !!(user.user_metadata && user.user_metadata.pending_empresa === true);
      if(pendente){
        await finalizarCadastroPendente(user);
      } else {
        mostrarEstadoContexto({
          titulo: 'Sem vínculo',
          mensagem: 'Sua conta não está associada a nenhuma empresa no momento.',
          acoes: [{ label: 'Sair', onClick: sairDaConta }]
        });
      }
      return;
    }

    // Calculada uma única vez aqui — chamar antes do ramo de 1 vínculo
    // garante que uma escolha salva inválida (empresa diferente da única
    // empresa vinculada, ou vínculo desativado) já é removida do
    // localStorage nesta mesma passagem, mesmo que não seja usada abaixo.
    const escolhaSalva = validarEscolhaSalva(user.id, vinculos);

    if(vinculos.length === 1){
      // Único vínculo — entra direto nele. Não usa escolhaSalva aqui: com
      // só uma empresa possível, não há "outra" para escolher a partir do
      // localStorage.
      await entrarNaEmpresa(vinculos[0]);
      return;
    }

    // Mais de um vínculo — nunca escolhe vinculos[0] arbitrariamente.
    if(escolhaSalva){
      await entrarNaEmpresa(escolhaSalva);
      return;
    }

    mostrarSeletorEmpresa(vinculos, (vinculoEscolhido)=>{
      persistirEscolhaERecarregar(user.id, vinculoEscolhido.empresa_id);
    });
  } finally {
    inicializandoApp = false;
  }
}

// ---------------- DADOS ----------------
async function carregarMarcasModelos(){
  const [{ data: marcas, error: errMarcas }, { data: modelos, error: errModelos }] = await Promise.all([
    sb.from('marcas').select('*').order('nome'),
    sb.from('modelos').select('*').order('nome'),
  ]);
  if(errMarcas){ alert('Erro ao carregar marcas: ' + errMarcas.message); }
  if(errModelos){ alert('Erro ao carregar modelos: ' + errModelos.message); }
  data.marcas = marcas || [];
  data.modelos = modelos || [];
}

async function carregarDados(){
  document.getElementById('loadingState').classList.remove('hidden');
  document.getElementById('appContent').classList.add('hidden');

  const [{ data: clientes }, { data: veiculos }, { data: pecas }, { data: fornecedores }, { data: os }, { data: osItens }, { data: movimentos }, { data: funcionarios }] = await Promise.all([
    sb.from('clientes').select('*').eq('empresa_id', empresaId).order('nome'),
    sb.from('veiculos').select('*').eq('empresa_id', empresaId),
    sb.from('pecas').select('*').eq('empresa_id', empresaId).order('nome'),
    sb.from('fornecedores').select('*').eq('empresa_id', empresaId).order('nome'),
    sb.from('ordens_servico').select('*').eq('empresa_id', empresaId).order('data', { ascending: false }),
    sb.from('os_itens').select('*'),
    sb.from('movimentos_caixa').select('*').eq('empresa_id', empresaId).order('data', { ascending: false }),
    sb.from('funcionarios').select('*').eq('empresa_id', empresaId).order('nome'),
  ]);
  data.clientes = clientes || [];
  data.veiculos = veiculos || [];
  data.pecas = pecas || [];
  data.fornecedores = fornecedores || [];
  data.os = os || [];
  data.funcionarios = funcionarios || [];
  const osIds = new Set(data.os.map(o=>o.id));
  data.osItens = (osItens || []).filter(it=>osIds.has(it.os_id));
  data.movimentos = movimentos || [];

  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('appContent').classList.remove('hidden');
  renderAll();
}

document.querySelectorAll('.nav-item').forEach(btn=>{
  btn.addEventListener('click', async ()=>{
    document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.add('hidden'));
    document.getElementById('tab-'+btn.dataset.tab).classList.remove('hidden');
    if(btn.dataset.tab === 'minhaoficina') await carregarUsuariosEmpresa();
  });
});

function closeModal(id){ document.getElementById(id).classList.remove('show'); }
function openModal(id){ document.getElementById(id).classList.add('show'); }

document.getElementById('buscaClientes').addEventListener('input', (e)=>{ filtroClientes = e.target.value.trim().toLowerCase(); renderClientes(); });
document.getElementById('filtroStatusClienteSelect').addEventListener('change', (e)=>{ filtroStatusCliente = e.target.value; renderClientes(); });
document.getElementById('buscaPecas').addEventListener('input', (e)=>{ filtroPecas = e.target.value.trim().toLowerCase(); renderPecas(); });
document.getElementById('buscaFornecedores').addEventListener('input', (e)=>{ filtroFornecedores = e.target.value.trim().toLowerCase(); renderFornecedores(); });
document.getElementById('buscaOS').addEventListener('input', (e)=>{ filtroOS = e.target.value.trim().toLowerCase(); renderOS(); });
document.getElementById('filtroPagoOSSelect').addEventListener('change', (e)=>{ filtroPagoOS = e.target.value; renderOS(); });
document.getElementById('filtroStatusOSSelect').addEventListener('change', (e)=>{ filtroStatusOS = e.target.value; renderOS(); });
document.getElementById('filtroDataOSInput').addEventListener('change', (e)=>{ filtroDataOS = e.target.value; renderOS(); });
document.getElementById('btnLimparFiltroDataOS').addEventListener('click', ()=>{ filtroDataOS=''; document.getElementById('filtroDataOSInput').value=''; renderOS(); });

// ---------------- CLIENTES ----------------
document.getElementById('btnNovoCliente').addEventListener('click', ()=>{
  document.getElementById('modalClienteTitle').textContent = 'Novo cliente';
  document.getElementById('clienteId').value = '';
  document.getElementById('clienteNome').value = '';
  document.getElementById('clienteCpf').value = '';
  document.getElementById('clienteTelefone').value = '';
  document.getElementById('clienteEmail').value = '';
  limparCampoVeiculoDoCliente();
  document.getElementById('clienteVeiculoSection').classList.remove('hidden');
  openModal('overlayCliente');
});

function limparCampoVeiculoDoCliente(){
  document.getElementById('clienteVeiculoPlaca').value = '';
  document.getElementById('clienteVeiculoBuscaMarca').value = '';
  document.getElementById('clienteVeiculoBuscaModelo').value = '';
  document.getElementById('clienteVeiculoMarcaId').value = '';
  document.getElementById('clienteVeiculoModeloId').value = '';
  document.getElementById('clienteVeiculoAnoFabricacao').value = '';
  document.getElementById('clienteVeiculoAnoModelo').value = '';
  document.getElementById('clienteVeiculoProximaRevisao').value = '';
  const campoModelo = document.getElementById('clienteVeiculoBuscaModelo');
  campoModelo.disabled = true;
  campoModelo.placeholder = 'Escolha a marca primeiro';
}

function editCliente(id){
  const c = data.clientes.find(x=>x.id===id);
  if(!c) return;
  document.getElementById('modalClienteTitle').textContent = 'Editar cliente';
  document.getElementById('clienteId').value = c.id;
  document.getElementById('clienteNome').value = c.nome;
  document.getElementById('clienteCpf').value = c.cpf || '';
  document.getElementById('clienteTelefone').value = c.telefone || '';
  document.getElementById('clienteEmail').value = c.email || '';
  document.getElementById('clienteVeiculoSection').classList.add('hidden');
  openModal('overlayCliente');
}

// ---- autocomplete de marca/modelo dentro do modal de Novo cliente ----
document.getElementById('clienteVeiculoBuscaMarca').addEventListener('input', (e)=>{
  const termo = e.target.value.trim().toLowerCase();
  document.getElementById('clienteVeiculoMarcaId').value = '';
  document.getElementById('clienteVeiculoModeloId').value = '';
  document.getElementById('clienteVeiculoBuscaModelo').value = '';
  document.getElementById('clienteVeiculoBuscaModelo').disabled = true;
  document.getElementById('clienteVeiculoBuscaModelo').placeholder = 'Escolha a marca primeiro';
  const sugEl = document.getElementById('clienteVeiculoMarcaSugestoes');
  if(!termo){ sugEl.classList.add('hidden'); sugEl.innerHTML=''; return; }
  const resultados = data.marcas.filter(m=>m.nome.toLowerCase().includes(termo)).slice(0,10);
  if(resultados.length===0){
    sugEl.innerHTML = `<div class="autocomplete-empty">Nenhuma marca encontrada</div>`;
    sugEl.classList.remove('hidden');
    return;
  }
  sugEl.innerHTML = resultados.map(m=>`<div class="autocomplete-item" onclick="selecionarMarcaClienteVeiculo('${m.id}')"><div class="ac-nome">${escapeHtml(m.nome)}</div></div>`).join('');
  sugEl.classList.remove('hidden');
});

function selecionarMarcaClienteVeiculo(marcaId){
  const m = data.marcas.find(x=>x.id===marcaId);
  if(!m) return;
  document.getElementById('clienteVeiculoMarcaId').value = m.id;
  document.getElementById('clienteVeiculoBuscaMarca').value = m.nome;
  document.getElementById('clienteVeiculoMarcaSugestoes').classList.add('hidden');
  const campoModelo = document.getElementById('clienteVeiculoBuscaModelo');
  campoModelo.disabled = false;
  campoModelo.placeholder = 'Digite pra buscar o modelo';
  campoModelo.value = '';
  document.getElementById('clienteVeiculoModeloId').value = '';
}

document.getElementById('clienteVeiculoBuscaModelo').addEventListener('input', (e)=>{
  const termo = e.target.value.trim().toLowerCase();
  const marcaId = document.getElementById('clienteVeiculoMarcaId').value;
  document.getElementById('clienteVeiculoModeloId').value = '';
  const sugEl = document.getElementById('clienteVeiculoModeloSugestoes');
  if(!termo || !marcaId){ sugEl.classList.add('hidden'); sugEl.innerHTML=''; return; }
  const resultados = data.modelos.filter(mo=>mo.marca_id===marcaId && mo.nome.toLowerCase().includes(termo)).slice(0,10);
  if(resultados.length===0){
    sugEl.innerHTML = `<div class="autocomplete-empty">Nenhum modelo encontrado — pode digitar manualmente</div>`;
    sugEl.classList.remove('hidden');
    return;
  }
  sugEl.innerHTML = resultados.map(mo=>`<div class="autocomplete-item" onclick="selecionarModeloClienteVeiculo('${mo.id}')"><div class="ac-nome">${escapeHtml(mo.nome)}</div></div>`).join('');
  sugEl.classList.remove('hidden');
});

function selecionarModeloClienteVeiculo(modeloId){
  const mo = data.modelos.find(x=>x.id===modeloId);
  if(!mo) return;
  document.getElementById('clienteVeiculoModeloId').value = mo.id;
  document.getElementById('clienteVeiculoBuscaModelo').value = mo.nome;
  document.getElementById('clienteVeiculoModeloSugestoes').classList.add('hidden');
}

document.addEventListener('click', (e)=>{
  const campoM = document.getElementById('clienteVeiculoBuscaMarca');
  const sugM = document.getElementById('clienteVeiculoMarcaSugestoes');
  if(campoM && sugM && !campoM.contains(e.target) && !sugM.contains(e.target)){ sugM.classList.add('hidden'); }
  const campoMo = document.getElementById('clienteVeiculoBuscaModelo');
  const sugMo = document.getElementById('clienteVeiculoModeloSugestoes');
  if(campoMo && sugMo && !campoMo.contains(e.target) && !sugMo.contains(e.target)){ sugMo.classList.add('hidden'); }
});

document.getElementById('salvarClienteBtn').addEventListener('click', async ()=>{
  const id = document.getElementById('clienteId').value;
  const nome = document.getElementById('clienteNome').value.trim();
  const cpf = document.getElementById('clienteCpf').value.trim();
  const telefone = document.getElementById('clienteTelefone').value.trim();
  const email = document.getElementById('clienteEmail').value.trim();
  if(!nome){ alert('Informe o nome do cliente.'); return; }
  if(id){
    const { error } = await sb.from('clientes').update({ nome, cpf, telefone, email }).eq('id', id);
    if(error){ alert('Erro ao salvar cliente: ' + error.message); return; }
  } else {
    const { data: novoCliente, error } = await sb.from('clientes').insert({ empresa_id: empresaId, nome, cpf, telefone, email }).select();
    if(error){ alert('Erro ao salvar cliente: ' + error.message); return; }
    const novoClienteId = novoCliente && novoCliente[0] ? novoCliente[0].id : null;

    const placa = document.getElementById('clienteVeiculoPlaca').value.trim().toUpperCase();
    const modelo = document.getElementById('clienteVeiculoBuscaModelo').value.trim();
    if(novoClienteId && placa && modelo){
      const marca_id = document.getElementById('clienteVeiculoMarcaId').value || null;
      const modelo_id = document.getElementById('clienteVeiculoModeloId').value || null;
      const ano_fabricacao = parseInt(document.getElementById('clienteVeiculoAnoFabricacao').value) || null;
      const ano_modelo = parseInt(document.getElementById('clienteVeiculoAnoModelo').value) || null;
      const proxima_revisao = document.getElementById('clienteVeiculoProximaRevisao').value || null;
      const { error: errVeiculo } = await sb.from('veiculos').insert({
        empresa_id: empresaId, cliente_id: novoClienteId, placa, modelo, marca_id, modelo_id, ano_fabricacao, ano_modelo, proxima_revisao
      });
      if(errVeiculo){ alert('Cliente salvo, mas houve um erro ao salvar o veículo: ' + errVeiculo.message); closeModal('overlayCliente'); await carregarDados(); return; }
    } else if(novoClienteId && (placa || modelo) && !(placa && modelo)){
      alert('Cliente salvo! Só não deu pra salvar o veículo: informe placa e modelo juntos, ou deixe os dois em branco.');
    }
  }
  closeModal('overlayCliente');
  await carregarDados();
});

async function toggleClienteAtivo(id){
  const c = data.clientes.find(x=>x.id===id);
  if(!c) return;
  const novoStatus = !(c.ativo !== false);
  const { error } = await sb.from('clientes').update({ ativo: novoStatus }).eq('id', id);
  if(error){ alert('Erro ao atualizar status do cliente: ' + error.message); return; }
  await carregarDados();
}

function lembrarRetorno(id){
  const c = data.clientes.find(x=>x.id===id);
  if(!c) return;
  if(!c.telefone){ alert('Este cliente não tem telefone cadastrado.'); return; }
  const msg = `Olá, ${c.nome.split(' ')[0]}! Aqui é da ${empresaNome}. Faz um tempo que você não aparece por aqui — que tal agendar uma revisão ou dar uma passada pra gente cuidar do seu veículo?`;
  window.open(waLink(c.telefone, msg), '_blank');
}

async function excluirCliente(id){
  if(!confirm('Excluir este cliente?')) return;
  await sb.from('clientes').delete().eq('id', id);
  await carregarDados();
}

// ---------------- VEICULOS ----------------
function abrirModalVeiculo(clienteId){
  if(data.clientes.length===0){ alert('Cadastre um cliente antes de adicionar um veículo.'); return; }
  document.getElementById('modalVeiculoTitle').textContent = 'Novo veículo';
  document.getElementById('veiculoId').value = '';
  document.getElementById('veiculoPlaca').value = '';
  document.getElementById('veiculoAnoFabricacao').value = '';
  document.getElementById('veiculoAnoModelo').value = '';
  document.getElementById('veiculoProximaRevisao').value = '';
  document.getElementById('veiculoMarcaId').value = '';
  document.getElementById('veiculoModeloId').value = '';
  document.getElementById('veiculoBuscaMarca').value = '';
  document.getElementById('veiculoBuscaModelo').value = '';
  document.getElementById('veiculoBuscaModelo').disabled = true;
  document.getElementById('veiculoBuscaModelo').placeholder = 'Escolha a marca primeiro';
  document.getElementById('veiculoMarcaSugestoes').classList.add('hidden');
  document.getElementById('veiculoModeloSugestoes').classList.add('hidden');
  populateClienteSelect(clienteId);
  openModal('overlayVeiculo');
}

function populateClienteSelect(selectedId){
  const sel = document.getElementById('veiculoCliente');
  sel.innerHTML = data.clientes.map(c=>`<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('');
  if(selectedId) sel.value = selectedId;
}

// ---- autocomplete de marca ----
document.getElementById('veiculoBuscaMarca').addEventListener('input', (e)=>{
  const termo = e.target.value.trim().toLowerCase();
  document.getElementById('veiculoMarcaId').value = '';
  document.getElementById('veiculoModeloId').value = '';
  document.getElementById('veiculoBuscaModelo').value = '';
  document.getElementById('veiculoBuscaModelo').disabled = true;
  document.getElementById('veiculoBuscaModelo').placeholder = 'Escolha a marca primeiro';
  const sugEl = document.getElementById('veiculoMarcaSugestoes');
  if(!termo){ sugEl.classList.add('hidden'); sugEl.innerHTML=''; return; }
  const resultados = data.marcas.filter(m=>m.nome.toLowerCase().includes(termo)).slice(0,10);
  if(resultados.length===0){
    sugEl.innerHTML = `<div class="autocomplete-empty">Nenhuma marca encontrada</div>`;
    sugEl.classList.remove('hidden');
    return;
  }
  sugEl.innerHTML = resultados.map(m=>`<div class="autocomplete-item" onclick="selecionarMarcaVeiculo('${m.id}')"><div class="ac-nome">${escapeHtml(m.nome)}</div></div>`).join('');
  sugEl.classList.remove('hidden');
});

function selecionarMarcaVeiculo(marcaId){
  const m = data.marcas.find(x=>x.id===marcaId);
  if(!m) return;
  document.getElementById('veiculoMarcaId').value = m.id;
  document.getElementById('veiculoBuscaMarca').value = m.nome;
  document.getElementById('veiculoMarcaSugestoes').classList.add('hidden');
  const campoModelo = document.getElementById('veiculoBuscaModelo');
  campoModelo.disabled = false;
  campoModelo.placeholder = 'Digite pra buscar o modelo';
  campoModelo.value = '';
  document.getElementById('veiculoModeloId').value = '';
  campoModelo.focus();
}

// ---- autocomplete de modelo (filtrado pela marca escolhida) ----
document.getElementById('veiculoBuscaModelo').addEventListener('input', (e)=>{
  const termo = e.target.value.trim().toLowerCase();
  const marcaId = document.getElementById('veiculoMarcaId').value;
  document.getElementById('veiculoModeloId').value = '';
  const sugEl = document.getElementById('veiculoModeloSugestoes');
  if(!termo || !marcaId){ sugEl.classList.add('hidden'); sugEl.innerHTML=''; return; }
  const resultados = data.modelos.filter(mo=>mo.marca_id===marcaId && mo.nome.toLowerCase().includes(termo)).slice(0,10);
  if(resultados.length===0){
    sugEl.innerHTML = `<div class="autocomplete-empty">Nenhum modelo encontrado — pode digitar manualmente</div>`;
    sugEl.classList.remove('hidden');
    return;
  }
  sugEl.innerHTML = resultados.map(mo=>`<div class="autocomplete-item" onclick="selecionarModeloVeiculo('${mo.id}')"><div class="ac-nome">${escapeHtml(mo.nome)}</div></div>`).join('');
  sugEl.classList.remove('hidden');
});

function selecionarModeloVeiculo(modeloId){
  const mo = data.modelos.find(x=>x.id===modeloId);
  if(!mo) return;
  document.getElementById('veiculoModeloId').value = mo.id;
  document.getElementById('veiculoBuscaModelo').value = mo.nome;
  document.getElementById('veiculoModeloSugestoes').classList.add('hidden');
}

document.addEventListener('click', (e)=>{
  const campoMarca = document.getElementById('veiculoBuscaMarca');
  const sugMarca = document.getElementById('veiculoMarcaSugestoes');
  if(campoMarca && sugMarca && !campoMarca.contains(e.target) && !sugMarca.contains(e.target)){
    sugMarca.classList.add('hidden');
  }
  const campoModelo = document.getElementById('veiculoBuscaModelo');
  const sugModelo = document.getElementById('veiculoModeloSugestoes');
  if(campoModelo && sugModelo && !campoModelo.contains(e.target) && !sugModelo.contains(e.target)){
    sugModelo.classList.add('hidden');
  }
});

function editVeiculo(id){
  const v = data.veiculos.find(x=>x.id===id);
  if(!v) return;
  document.getElementById('modalVeiculoTitle').textContent = 'Editar veículo';
  document.getElementById('veiculoId').value = v.id;
  document.getElementById('veiculoPlaca').value = v.placa;
  document.getElementById('veiculoAnoFabricacao').value = v.ano_fabricacao || '';
  document.getElementById('veiculoAnoModelo').value = v.ano_modelo || '';
  document.getElementById('veiculoProximaRevisao').value = v.proxima_revisao || '';

  const marca = data.marcas.find(m=>m.id===v.marca_id);
  const modelo = data.modelos.find(mo=>mo.id===v.modelo_id);
  document.getElementById('veiculoMarcaId').value = v.marca_id || '';
  document.getElementById('veiculoModeloId').value = v.modelo_id || '';
  document.getElementById('veiculoBuscaMarca').value = marca ? marca.nome : '';
  const campoModelo = document.getElementById('veiculoBuscaModelo');
  // veículo antigo, sem marca/modelo cadastrados: mantém o texto livre já existente
  campoModelo.value = modelo ? modelo.nome : (v.modelo || '');
  campoModelo.disabled = !marca;
  campoModelo.placeholder = marca ? 'Digite pra buscar o modelo' : 'Escolha a marca primeiro';

  populateClienteSelect(v.cliente_id);
  openModal('overlayVeiculo');
}

document.getElementById('salvarVeiculoBtn').addEventListener('click', async ()=>{
  const id = document.getElementById('veiculoId').value;
  const cliente_id = document.getElementById('veiculoCliente').value;
  const placa = document.getElementById('veiculoPlaca').value.trim().toUpperCase();
  const marca_id = document.getElementById('veiculoMarcaId').value || null;
  const modelo_id = document.getElementById('veiculoModeloId').value || null;
  // "modelo" (texto) sempre é preenchido — pelo nome selecionado, ou pelo texto digitado manualmente
  const modelo = document.getElementById('veiculoBuscaModelo').value.trim();
  const ano_fabricacao = parseInt(document.getElementById('veiculoAnoFabricacao').value) || null;
  const ano_modelo = parseInt(document.getElementById('veiculoAnoModelo').value) || null;
  const proxima_revisao = document.getElementById('veiculoProximaRevisao').value || null;
  if(!cliente_id){ alert('Todo veículo precisa estar vinculado a um cliente.'); return; }
  if(!placa || !modelo){ alert('Informe placa e modelo.'); return; }
  if(id){
    const { error } = await sb.from('veiculos').update({ cliente_id, placa, modelo, marca_id, modelo_id, ano_fabricacao, ano_modelo, proxima_revisao }).eq('id', id);
    if(error){ alert('Erro ao salvar veículo: ' + error.message); return; }
  } else {
    const { error } = await sb.from('veiculos').insert({ empresa_id: empresaId, cliente_id, placa, modelo, marca_id, modelo_id, ano_fabricacao, ano_modelo, proxima_revisao });
    if(error){ alert('Erro ao salvar veículo: ' + error.message); return; }
  }
  closeModal('overlayVeiculo');
  await carregarDados();
});

async function excluirVeiculo(id){
  if(!confirm('Excluir este veículo?')) return;
  await sb.from('veiculos').delete().eq('id', id);
  await carregarDados();
}


async function marcarContatado(veiculoId){
  const v = data.veiculos.find(x=>x.id===veiculoId);
  if(!v) return;
  const hoje = hojeLocal();
  const novoCount = (v.contatos_count || 0) + 1;
  await sb.from('veiculos').update({ ultimo_contato: hoje, contatos_count: novoCount }).eq('id', veiculoId);
  v.ultimo_contato = hoje;
  v.contatos_count = novoCount;
  renderPainel();
}

async function marcarRevisaoFeita(veiculoId){
  const novaData = prompt('Nova data da próxima revisão (AAAA-MM-DD):', '');
  if(!novaData) return;
  await sb.from('veiculos').update({ proxima_revisao: novaData, ultimo_contato: null, contatos_count: 0, sem_retorno: false }).eq('id', veiculoId);
  await carregarDados();
}

async function reabrirFila(veiculoId){
  await sb.from('veiculos').update({ sem_retorno: false, contatos_count: 0, ultimo_contato: null }).eq('id', veiculoId);
  await carregarDados();
}

// ---------------- ORDENS DE SERVICO ----------------
document.getElementById('btnNovaOS').addEventListener('click', ()=>{
  abrirModalOS();
});

function abrirModalOS(clienteId, veiculoId){
  document.getElementById('modalOSTitle').textContent = 'Nova ordem de serviço';
  document.getElementById('osId').value = '';
  document.getElementById('osClienteId').value = '';
  document.getElementById('osDescricao').value = '';
  document.getElementById('osMaoDeObra').value = '';
  document.getElementById('osGarantiaMaoDeObra').value = '';
  document.getElementById('osGarantiaPecas').value = '';
  populateFuncionarioSelect();
  document.getElementById('osBuscaPeca').value = '';
  document.getElementById('osItemPecaId').value = '';
  document.getElementById('osItemQtd').value = 1;
  document.getElementById('osItemPreco').value = '';
  document.getElementById('osSugestoes').classList.add('hidden');
  document.getElementById('osPecaSugestoes').classList.add('hidden');
  osItensAtual = [];
  renderOSItensLista();
  if(clienteId){
    selecionarClienteOS(clienteId);
    if(veiculoId) document.getElementById('osVeiculo').value = veiculoId;
  } else {
    document.getElementById('osBuscaCliente').value = '';
    document.getElementById('osVeiculo').innerHTML = '<option value="">Busque um cliente primeiro</option>';
  }
  openModal('overlayOS');
}

document.getElementById('osBuscaCliente').addEventListener('input', (e)=>{
  const termo = e.target.value.trim().toLowerCase();
  document.getElementById('osClienteId').value = '';
  document.getElementById('osVeiculo').innerHTML = '<option value="">Busque um cliente primeiro</option>';
  const sugestoesEl = document.getElementById('osSugestoes');
  if(!termo){ sugestoesEl.classList.add('hidden'); sugestoesEl.innerHTML = ''; return; }
  const resultados = data.clientes.filter(c=>{
    const veiculosCliente = data.veiculos.filter(v=>v.cliente_id===c.id);
    const placas = veiculosCliente.map(v=>(v.placa||'').toLowerCase()).join(' ');
    return c.nome.toLowerCase().includes(termo) || (c.telefone||'').toLowerCase().includes(termo) || (c.cpf||'').toLowerCase().includes(termo) || placas.includes(termo);
  }).slice(0,8);
  if(resultados.length===0){
    sugestoesEl.innerHTML = `<div class="autocomplete-empty">Nenhum cliente encontrado</div>`;
    sugestoesEl.classList.remove('hidden');
    return;
  }
  sugestoesEl.innerHTML = resultados.map(c=>{
    const nVeiculos = data.veiculos.filter(v=>v.cliente_id===c.id).length;
    return `<div class="autocomplete-item" onclick="selecionarClienteOS('${c.id}')">
      <div class="ac-nome">${escapeHtml(c.nome)}</div>
      <div class="ac-sub">${escapeHtml(c.telefone||'sem telefone')} · ${nVeiculos} veículo${nVeiculos===1?'':'s'}</div>
    </div>`;
  }).join('');
  sugestoesEl.classList.remove('hidden');
});

function selecionarClienteOS(clienteId){
  const c = data.clientes.find(x=>x.id===clienteId);
  if(!c) return;
  document.getElementById('osClienteId').value = c.id;
  document.getElementById('osBuscaCliente').value = c.nome;
  document.getElementById('osSugestoes').classList.add('hidden');
  const veiculosCliente = data.veiculos.filter(v=>v.cliente_id===c.id);
  const sel = document.getElementById('osVeiculo');
  sel.innerHTML = veiculosCliente.length===0
    ? '<option value="">Cliente sem veículo cadastrado</option>'
    : veiculosCliente.map(v=>`<option value="${v.id}">${escapeHtml(v.placa)} — ${escapeHtml(v.modelo)}</option>`).join('');
}

document.getElementById('osBuscaPeca').addEventListener('input', (e)=>{
  const termo = e.target.value.trim().toLowerCase();
  document.getElementById('osItemPecaId').value = '';
  const sugestoesEl = document.getElementById('osPecaSugestoes');
  if(!termo){ sugestoesEl.classList.add('hidden'); sugestoesEl.innerHTML = ''; return; }
  const resultados = data.pecas.filter(p=>p.nome.toLowerCase().includes(termo)).slice(0,8);
  if(resultados.length===0){
    sugestoesEl.innerHTML = `<div class="autocomplete-empty">Nenhuma peça encontrada</div>`;
    sugestoesEl.classList.remove('hidden');
    return;
  }
  sugestoesEl.innerHTML = resultados.map(p=>`<div class="autocomplete-item" onclick="selecionarPecaOS('${p.id}')">
      <div class="ac-nome">${escapeHtml(p.nome)}</div>
      <div class="ac-sub">Estoque: ${p.qtd} · Venda: R$ ${Number(p.preco).toFixed(2)}</div>
    </div>`).join('');
  sugestoesEl.classList.remove('hidden');
});

function selecionarPecaOS(pecaId){
  const p = data.pecas.find(x=>x.id===pecaId);
  if(!p) return;
  document.getElementById('osItemPecaId').value = p.id;
  document.getElementById('osBuscaPeca').value = p.nome;
  document.getElementById('osPecaSugestoes').classList.add('hidden');
  const fornecedor = data.fornecedores.find(f=>f.id===p.fornecedor_id);
  const semMargem = fornecedor && fornecedor.ganha_margem === false;
  const sugestao = semMargem ? (p.custo || 0) : p.preco;
  document.getElementById('osItemPreco').value = Number(sugestao).toFixed(2);
}

document.getElementById('btnAdicionarItemOS').addEventListener('click', ()=>{
  const pecaId = document.getElementById('osItemPecaId').value;
  if(!pecaId){ alert('Busque e selecione uma peça.'); return; }
  const p = data.pecas.find(x=>x.id===pecaId);
  if(!p) return;
  const quantidade = parseInt(document.getElementById('osItemQtd').value) || 0;
  const preco_unitario = parseFloat(document.getElementById('osItemPreco').value) || 0;
  if(quantidade <= 0){ alert('Informe uma quantidade válida.'); return; }
  osItensAtual.push({ peca_id: p.id, nome: p.nome, quantidade, preco_unitario, custo_unitario: p.custo || 0 });
  document.getElementById('osBuscaPeca').value = '';
  document.getElementById('osItemPecaId').value = '';
  document.getElementById('osItemQtd').value = 1;
  document.getElementById('osItemPreco').value = '';
  renderOSItensLista();
  atualizarOSTotalPreview();
});

function removerItemOS(index){
  osItensAtual.splice(index, 1);
  renderOSItensLista();
  atualizarOSTotalPreview();
}

function renderOSItensLista(){
  const wrap = document.getElementById('osItensLista');
  if(osItensAtual.length===0){ wrap.innerHTML = `<div class="empty-note" style="padding:6px 2px;">Nenhuma peça adicionada.</div>`; return; }
  wrap.innerHTML = osItensAtual.map((it,i)=>{
    const subtotal = it.quantidade * it.preco_unitario;
    return `<div class="os-item-row"><span>${escapeHtml(it.nome)} — ${it.quantidade}x R$ ${it.preco_unitario.toFixed(2)} = R$ ${subtotal.toFixed(2)}</span><button type="button" class="os-item-remove" onclick="removerItemOS(${i})">remover</button></div>`;
  }).join('');
}

function atualizarOSTotalPreview(){
  const maoDeObra = parseFloat(document.getElementById('osMaoDeObra').value) || 0;
  const totalPecas = osItensAtual.reduce((s,it)=>s+it.quantidade*it.preco_unitario, 0);
  document.getElementById('osTotalPreview').textContent = formatBRL(maoDeObra + totalPecas);
}
document.getElementById('osMaoDeObra').addEventListener('input', atualizarOSTotalPreview);

document.addEventListener('click', (e)=>{
  const campoCliente = document.getElementById('osBuscaCliente');
  const sugCliente = document.getElementById('osSugestoes');
  if(campoCliente && sugCliente && !campoCliente.contains(e.target) && !sugCliente.contains(e.target)){
    sugCliente.classList.add('hidden');
  }
  const campoPeca = document.getElementById('osBuscaPeca');
  const sugPeca = document.getElementById('osPecaSugestoes');
  if(campoPeca && sugPeca && !campoPeca.contains(e.target) && !sugPeca.contains(e.target)){
    sugPeca.classList.add('hidden');
  }
});

function editOS(id){
  const os = data.os.find(x=>x.id===id);
  if(!os) return;
  document.getElementById('modalOSTitle').textContent = 'Editar ordem de serviço';
  document.getElementById('osId').value = os.id;
  document.getElementById('osDescricao').value = os.descricao || '';
  document.getElementById('osMaoDeObra').value = os.mao_de_obra || '';
  document.getElementById('osGarantiaMaoDeObra').value = os.garantia_maodeobra_dias || '';
  document.getElementById('osGarantiaPecas').value = os.garantia_pecas_dias || '';
  populateFuncionarioSelect(os.funcionario_id);
  selecionarClienteOS(os.cliente_id);
  if(os.veiculo_id) document.getElementById('osVeiculo').value = os.veiculo_id;
  osItensAtual = data.osItens.filter(it=>it.os_id===os.id).map(it=>({
    peca_id: it.peca_id, nome: it.nome_peca, quantidade: it.quantidade,
    preco_unitario: Number(it.preco_unitario), custo_unitario: Number(it.custo_unitario)
  }));
  renderOSItensLista();
  atualizarOSTotalPreview();
  openModal('overlayOS');
}

document.getElementById('salvarOSBtn').addEventListener('click', async ()=>{
  const id = document.getElementById('osId').value;
  const cliente_id = document.getElementById('osClienteId').value;
  const veiculo_id = document.getElementById('osVeiculo').value || null;
  const descricao = document.getElementById('osDescricao').value.trim();
  const mao_de_obra = parseFloat(document.getElementById('osMaoDeObra').value) || 0;
  const garantia_maodeobra_dias = parseInt(document.getElementById('osGarantiaMaoDeObra').value) || null;
  const garantia_pecas_dias = parseInt(document.getElementById('osGarantiaPecas').value) || null;
  const funcionario_id = document.getElementById('osFuncionario').value || null;
  if(!cliente_id){ alert('Busque e selecione um cliente.'); return; }

  let osId = id;
  if(id){
    const { error: errUpdate } = await sb.from('ordens_servico').update({ cliente_id, veiculo_id, descricao, mao_de_obra, garantia_maodeobra_dias, garantia_pecas_dias, funcionario_id }).eq('id', id);
    if(errUpdate){ alert('Erro ao salvar OS: ' + errUpdate.message); return; }
    const { error: errDelItens } = await sb.from('os_itens').delete().eq('os_id', id);
    if(errDelItens){ alert('Erro ao atualizar itens da OS: ' + errDelItens.message); return; }
  } else {
    const { data: novaOS, error: errInsert } = await sb.from('ordens_servico').insert({
      empresa_id: empresaId, cliente_id, veiculo_id, descricao, mao_de_obra,
      garantia_maodeobra_dias, garantia_pecas_dias, funcionario_id, status: 'pendente', pago: false
    }).select();
    if(errInsert){ alert('Erro ao criar OS: ' + errInsert.message); return; }
    osId = novaOS && novaOS[0] ? novaOS[0].id : null;
  }
  if(osId && osItensAtual.length > 0){
    const { error: errItens } = await sb.from('os_itens').insert(osItensAtual.map(it=>({
      os_id: osId, peca_id: it.peca_id, nome_peca: it.nome, quantidade: it.quantidade,
      preco_unitario: it.preco_unitario, custo_unitario: it.custo_unitario
    })));
    if(errItens){ alert('Erro ao salvar peças da OS: ' + errItens.message); return; }
  }
  closeModal('overlayOS');
  await carregarDados();
});

function totalOS(os){
  const itens = data.osItens.filter(it=>it.os_id===os.id);
  const totalPecas = itens.reduce((s,it)=>s+it.quantidade*Number(it.preco_unitario), 0);
  return Number(os.mao_de_obra || 0) + totalPecas;
}

const ETAPAS_OS = [
  { id: 'orcamento', label: 'Orçamento' },
  { id: 'pendente', label: 'Pendente' },
  { id: 'em_andamento', label: 'Em andamento' },
  { id: 'pronto', label: 'Pronto' },
  { id: 'entregue', label: 'Entregue' },
];

async function moverStatusOS(id, novoStatus){
  const os = data.os.find(x=>x.id===id);
  if(!os) return;
  const { error: errStatus } = await sb.from('ordens_servico').update({ status: novoStatus }).eq('id', id);
  if(errStatus){ alert('Erro ao mover a OS: ' + errStatus.message); return; }

  // ao chegar em "Entregue", dá baixa no estoque das peças usadas (uma vez só)
  if(novoStatus === 'entregue' && !os.estoque_baixado){
    const itens = data.osItens.filter(it=>it.os_id===id);
    for(const it of itens){
      if(!it.peca_id) continue;
      const p = data.pecas.find(x=>x.id===it.peca_id);
      if(!p) continue;
      const novaQtd = Math.max(0, (p.qtd||0) - it.quantidade);
      const { error: errQtd } = await sb.from('pecas').update({ qtd: novaQtd }).eq('id', p.id);
      if(errQtd){ alert(`Erro ao dar baixa em "${p.nome}": ` + errQtd.message); return; }
    }
    const { error: errFlag } = await sb.from('ordens_servico').update({ estoque_baixado: true }).eq('id', id);
    if(errFlag){ alert('Erro ao marcar baixa de estoque da OS: ' + errFlag.message); return; }
  }
  await carregarDados();
}

async function marcarOSPaga(id){
  const os = data.os.find(x=>x.id===id);
  if(!os || os.pago) return;
  const cliente = data.clientes.find(c=>c.id===os.cliente_id);
  const total = totalOS(os);
  const hoje = hojeLocal();
  const { error: errPago } = await sb.from('ordens_servico').update({ pago: true, pago_em: hoje }).eq('id', id);
  if(errPago){ alert('Erro ao marcar OS como paga: ' + errPago.message); return; }
  const { error: errMov } = await sb.from('movimentos_caixa').insert({
    empresa_id: empresaId, tipo: 'entrada', categoria: 'os',
    descricao: `Pagamento OS — ${cliente ? cliente.nome : 'cliente'}`,
    valor: total, os_id: id, data: hoje
  });
  if(errMov){ alert('Erro ao lançar no caixa: ' + errMov.message); return; }
  await carregarDados();
}

async function excluirOS(id){
  const os = data.os.find(x=>x.id===id);
  let aviso = 'Excluir esta ordem de serviço?';
  if(os && os.estoque_baixado) aviso += '\n\nAs peças já baixadas do estoque NÃO voltam (o estoque continua como está).';
  if(os && os.pago) aviso += '\n\nO valor já lançado no caixa NÃO é removido (o faturamento continua como está). Use "Cancelar OS" em vez de excluir se precisar desfazer isso.';
  if(!confirm(aviso)) return;
  const { error } = await sb.from('ordens_servico').delete().eq('id', id);
  if(error){ alert('Erro ao excluir OS: ' + error.message); return; }
  await carregarDados();
}

async function cancelarOS(id){
  const os = data.os.find(x=>x.id===id);
  if(!os) return;
  if(os.cancelada){ alert('Essa OS já está cancelada.'); return; }
  if(!confirm('Cancelar esta OS? Isso devolve as peças usadas ao estoque (se já tinham sido baixadas) e remove o lançamento no caixa (se já tinha sido marcada como paga). O registro da OS continua salvo, só marcado como cancelado.')) return;

  if(os.estoque_baixado){
    const itens = data.osItens.filter(it=>it.os_id===id);
    for(const it of itens){
      if(!it.peca_id) continue;
      const p = data.pecas.find(x=>x.id===it.peca_id);
      if(!p) continue;
      const { error: errQtd } = await sb.from('pecas').update({ qtd: (p.qtd||0) + it.quantidade }).eq('id', p.id);
      if(errQtd){ alert(`Erro ao devolver "${p.nome}" ao estoque: ` + errQtd.message); return; }
    }
  }
  if(os.pago){
    const { error: errMov } = await sb.from('movimentos_caixa').delete().eq('os_id', id);
    if(errMov){ alert('Erro ao remover lançamento do caixa: ' + errMov.message); return; }
  }
  const { error: errCancel } = await sb.from('ordens_servico').update({
    cancelada: true, cancelada_em: hojeLocal(), estoque_baixado: false, pago: false, pago_em: null
  }).eq('id', id);
  if(errCancel){ alert('Erro ao cancelar OS: ' + errCancel.message); return; }
  await carregarDados();
}

function enviarOSWhatsapp(id){
  const os = data.os.find(x=>x.id===id);
  if(!os) return;
  const cliente = data.clientes.find(c=>c.id===os.cliente_id);
  if(!cliente || !cliente.telefone){ alert('Este cliente não tem telefone cadastrado.'); return; }
  const veiculo = data.veiculos.find(v=>v.id===os.veiculo_id);
  const itens = data.osItens.filter(it=>it.os_id===os.id);
  const total = totalOS(os);
  let msg = `Olá, ${cliente.nome.split(' ')[0]}! Aqui é da ${empresaNome}.\n\nSegue o resumo da Ordem de Serviço`;
  msg += veiculo ? ` do seu ${veiculo.modelo} (placa ${veiculo.placa}):\n\n` : `:\n\n`;
  if(os.descricao) msg += `Serviço: ${os.descricao}\n\n`;
  if(itens.length > 0){
    msg += `Peças utilizadas:\n`;
    itens.forEach(it=>{ msg += `- ${it.nome_peca} x${it.quantidade} — R$ ${Number(it.preco_unitario).toFixed(2)}\n`; });
    msg += `\n`;
  }
  msg += `Mão de obra: R$ ${Number(os.mao_de_obra||0).toFixed(2)}\nTotal: R$ ${total.toFixed(2)}\n\n`;
  if(os.garantia_maodeobra_dias || os.garantia_pecas_dias){
    msg += `Garantia: `;
    if(os.garantia_maodeobra_dias) msg += `${os.garantia_maodeobra_dias} dias na mão de obra`;
    if(os.garantia_maodeobra_dias && os.garantia_pecas_dias) msg += ` e `;
    if(os.garantia_pecas_dias) msg += `${os.garantia_pecas_dias} dias nas peças`;
    msg += `.\n\n`;
  }
  msg += `Qualquer problema, é só chamar a gente que iremos avaliar!`;
  window.open(waLink(cliente.telefone, msg), '_blank');
}

function toggleColunaOS(etapaId){
  colunasExpandidas[etapaId] = !colunasExpandidas[etapaId];
  renderOS();
}

function renderOS(){
  const wrap = document.getElementById('osKanban');
  const termo = filtroOS;
  let lista = [...data.os];
  if(filtroPagoOS) lista = lista.filter(o=> filtroPagoOS === 'pago' ? o.pago : !o.pago);
  if(filtroDataOS) lista = lista.filter(o=> o.data === filtroDataOS);
  if(termo){
    lista = lista.filter(o=>{
      const cliente = data.clientes.find(c=>c.id===o.cliente_id);
      const veiculo = data.veiculos.find(v=>v.id===o.veiculo_id);
      return (cliente ? cliente.nome.toLowerCase().includes(termo) : false)
        || (veiculo ? (veiculo.placa||'').toLowerCase().includes(termo) : false)
        || (o.descricao||'').toLowerCase().includes(termo);
    });
  }

  const LIMITE_CARDS_COLUNA = 5;
  const etapasVisiveis = filtroStatusOS ? ETAPAS_OS.filter(e=>e.id===filtroStatusOS) : ETAPAS_OS;

  wrap.innerHTML = etapasVisiveis.map(etapa=>{
    const todasDaEtapa = lista.filter(o=>(o.status||'pendente') === etapa.id);
    const expandida = !!colunasExpandidas[etapa.id];
    const osDaEtapa = expandida ? todasDaEtapa : todasDaEtapa.slice(0, LIMITE_CARDS_COLUNA);
    const escondidas = todasDaEtapa.length - osDaEtapa.length;
    const cardsHtml = todasDaEtapa.length === 0
      ? `<div class="empty-note" style="padding:6px 2px;">Nada aqui.</div>`
      : osDaEtapa.map(o=>{
          const cliente = data.clientes.find(c=>c.id===o.cliente_id);
          const veiculo = data.veiculos.find(v=>v.id===o.veiculo_id);
          const funcionario = data.funcionarios.find(f=>f.id===o.funcionario_id);
          const total = totalOS(o);
          const servicos = (o.descricao||'').split(/\n|;/).map(s=>s.trim()).filter(Boolean);
          const servicosHtml = servicos.length>0
            ? `<ul class="os-servicos-lista">${servicos.map(s=>`<li>${escapeHtml(s)}</li>`).join('')}</ul>`
            : `<div class="os-sem-servico">Sem descrição do serviço</div>`;
          const statusClasse = o.cancelada ? 'status-cancelada' : (o.pago ? 'status-pago' : 'status-pendente-pg');
          const selectEtapas = o.cancelada
            ? ''
            : `<select onchange="moverStatusOS('${o.id}', this.value)">${ETAPAS_OS.map(e=>`<option value="${e.id}" ${e.id===etapa.id?'selected':''}>${e.label}</option>`).join('')}</select>`;
          const btnBaixa = (!o.cancelada && etapa.id==='entregue' && !o.estoque_baixado) ? `<button class="btn btn-ghost btn-sm" onclick="moverStatusOS('${o.id}','entregue')">Dar baixa no estoque</button>` : '';
          const btnPagar = (!o.cancelada && !o.pago) ? `<button class="btn os-pagar-btn" onclick="marcarOSPaga('${o.id}')">✓ Marcar como paga</button>` : '';
          const btnWhats = `<button class="wa-btn os-whats-btn" onclick="enviarOSWhatsapp('${o.id}')">📱 Falar no WhatsApp</button>`;
          return `<div class="os-card${o.cancelada ? ' os-card-cancelada' : ''}">
            <div class="os-card-cliente">${cliente ? escapeHtml(cliente.nome) : 'Cliente não vinculado'}${veiculo ? ` <span class="plate os-card-plate">${escapeHtml(veiculo.placa)}</span>` : ''}</div>

            <div class="os-card-row">🚗 <b>Veículo:</b> ${veiculo ? escapeHtml(veiculo.modelo) : '—'}</div>

            <div class="os-card-row">🔧 <b>Serviços executados:</b></div>
            ${servicosHtml}

            <div class="os-card-row">👤 <b>Responsável:</b> ${funcionario ? escapeHtml(funcionario.nome) : 'não informado'}</div>

            <div class="os-card-footer">
              <div class="os-card-total">Valor total: <strong>${formatBRL(total)}</strong></div>
              <span class="os-status-pill ${statusClasse}">${o.cancelada ? 'CANCELADA' : (o.pago ? 'PAGO' : 'PENDENTE')}</span>
            </div>

            <div class="os-card-actions">
              ${btnWhats}
              ${btnPagar}
              ${selectEtapas}
              <details class="os-menu">
                <summary>⋮</summary>
                <div class="os-menu-items">
                  <button class="btn btn-ghost btn-sm" onclick="editOS('${o.id}')">Editar</button>
                  ${btnBaixa}
                  ${!o.cancelada ? `<button class="btn btn-ghost btn-sm" onclick="cancelarOS('${o.id}')">Cancelar OS</button>` : ''}
                  <button class="btn btn-ghost btn-sm" onclick="excluirOS('${o.id}')">Excluir</button>
                </div>
              </details>
            </div>
          </div>`;
        }).join('');
    const botaoExpandir = todasDaEtapa.length > LIMITE_CARDS_COLUNA
      ? `<button class="btn btn-sm kanban-toggle-btn" onclick="toggleColunaOS('${etapa.id}')">${expandida ? 'Ver menos' : `Ver mais (${escondidas})`}</button>`
      : '';
    return `<div class="kanban-col">
      <div class="kanban-col-title">${etapa.label} <span class="kanban-count">${todasDaEtapa.length}</span></div>
      ${cardsHtml}
      ${botaoExpandir}
    </div>`;
  }).join('');
}

// ---------------- FINANCEIRO ----------------
document.getElementById('btnNovaDespesa').addEventListener('click', ()=>{
  document.getElementById('despesaCategoria').value = 'aluguel';
  document.getElementById('despesaDescricao').value = '';
  document.getElementById('despesaValor').value = '';
  document.getElementById('despesaData').value = hojeLocal();
  openModal('overlayDespesa');
});

document.getElementById('salvarDespesaBtn').addEventListener('click', async ()=>{
  const categoria = document.getElementById('despesaCategoria').value;
  const descricao = document.getElementById('despesaDescricao').value.trim();
  const valor = parseFloat(document.getElementById('despesaValor').value) || 0;
  const dataDespesa = document.getElementById('despesaData').value || hojeLocal();
  if(valor <= 0){ alert('Informe um valor maior que zero.'); return; }
  const { error } = await sb.from('movimentos_caixa').insert({ empresa_id: empresaId, tipo: 'saida', categoria, descricao, valor, data: dataDespesa });
  if(error){ alert('Erro ao salvar despesa: ' + error.message); return; }
  closeModal('overlayDespesa');
  await carregarDados();
});

async function excluirMovimento(id){
  if(!confirm('Excluir esta movimentação do caixa?')) return;
  await sb.from('movimentos_caixa').delete().eq('id', id);
  await carregarDados();
}

function categoriaLabel(cat){
  const labels = { os: 'Ordem de serviço', estoque: 'Reposição de estoque', aluguel: 'Aluguel', energia: 'Energia', agua: 'Água', funcionarios: 'Funcionários', outro: 'Outro' };
  return labels[cat] || cat;
}

document.getElementById('mesAnteriorFinanceiro').addEventListener('click', ()=>{ financeiroCursor.setMonth(financeiroCursor.getMonth()-1); renderFinanceiro(); });
document.getElementById('mesSeguinteFinanceiro').addEventListener('click', ()=>{ financeiroCursor.setMonth(financeiroCursor.getMonth()+1); renderFinanceiro(); });
document.getElementById('filtroTipoMovimentoSelect').addEventListener('change', (e)=>{ filtroTipoMovimento = e.target.value; renderFinanceiro(); });
document.getElementById('filtroCategoriaMovimentoSelect').addEventListener('change', (e)=>{ filtroCategoriaMovimento = e.target.value; renderFinanceiro(); });

function renderFinanceiro(){
  const hoje = new Date();
  const prefixMesAtual = hoje.toISOString().slice(0,7);
  const doMesAtual = data.movimentos.filter(m=>(m.data||'').startsWith(prefixMesAtual));
  const faturamentoAtual = doMesAtual.filter(m=>m.tipo==='entrada').reduce((s,m)=>s+Number(m.valor||0),0);
  const despesasAtual = doMesAtual.filter(m=>m.tipo==='saida').reduce((s,m)=>s+Number(m.valor||0),0);
  document.getElementById('statFaturamentoMes').textContent = formatBRL(faturamentoAtual);
  document.getElementById('statDespesasMes').textContent = formatBRL(despesasAtual);
  document.getElementById('statSaldoMes').textContent = formatBRL(faturamentoAtual - despesasAtual);

  document.getElementById('mesLabelFinanceiro').textContent = financeiroCursor.toLocaleDateString('pt-BR', { month:'long', year:'numeric' });
  const prefixMesSelecionado = financeiroCursor.toISOString().slice(0,7);
  let doMesSelecionado = data.movimentos.filter(m=>(m.data||'').startsWith(prefixMesSelecionado));
  if(filtroTipoMovimento) doMesSelecionado = doMesSelecionado.filter(m=>m.tipo===filtroTipoMovimento);
  if(filtroCategoriaMovimento) doMesSelecionado = doMesSelecionado.filter(m=>m.categoria===filtroCategoriaMovimento);

  const faturamento = doMesSelecionado.filter(m=>m.tipo==='entrada').reduce((s,m)=>s+Number(m.valor||0),0);
  const despesas = doMesSelecionado.filter(m=>m.tipo==='saida').reduce((s,m)=>s+Number(m.valor||0),0);
  const saldo = faturamento - despesas;
  document.getElementById('statFaturamentoMes2').textContent = formatBRL(faturamento);
  document.getElementById('statDespesasMes2').textContent = formatBRL(despesas);
  document.getElementById('statSaldoMes2').textContent = formatBRL(saldo);

  const body = document.getElementById('movimentosBody');
  if(doMesSelecionado.length===0){ body.innerHTML = `<tr><td colspan="6" class="empty-note">Nenhuma movimentação encontrada para esse período/filtro.</td></tr>`; return; }
  const lista = [...doMesSelecionado].sort((a,b)=> (b.data||'').localeCompare(a.data||''));
  body.innerHTML = lista.map(m=>{
    const dataLabel = m.data ? new Date(m.data+'T00:00:00').toLocaleDateString('pt-BR') : '—';
    const entrada = m.tipo === 'entrada';
    return `<tr>
      <td>${dataLabel}</td>
      <td><span class="tag-pill" style="${entrada ? 'color:var(--ok);' : 'color:var(--accent);'}">${entrada ? 'Entrada' : 'Saída'}</span></td>
      <td>${categoriaLabel(m.categoria)}</td>
      <td>${escapeHtml(m.descricao || '—')}</td>
      <td class="mono" style="${entrada ? 'color:var(--ok);' : 'color:var(--accent);'}">${entrada ? '+' : '−'} R$ ${Number(m.valor).toFixed(2)}</td>
      <td><div class="row-actions"><button class="btn btn-ghost btn-sm" onclick="excluirMovimento('${m.id}')">Excluir</button></div></td></tr>`;
  }).join('');
}

// ---------------- PECAS ----------------
document.getElementById('btnNovaPeca').addEventListener('click', ()=>{
  document.getElementById('modalPecaTitle').textContent = 'Nova peça';
  document.getElementById('pecaId').value = '';
  document.getElementById('pecaNome').value = '';
  document.getElementById('pecaQtd').value = '';
  document.getElementById('pecaMin').value = '';
  document.getElementById('pecaCusto').value = '';
  document.getElementById('pecaPreco').value = '';
  populateFornecedorSelect();
  openModal('overlayPeca');
});

function populateFornecedorSelect(selectedId){
  const sel = document.getElementById('pecaFornecedor');
  sel.innerHTML = '<option value="">Nenhum</option>' + data.fornecedores.map(f=>`<option value="${f.id}">${escapeHtml(f.nome)}</option>`).join('');
  sel.value = selectedId || '';
}

function editPeca(id){
  const p = data.pecas.find(x=>x.id===id);
  if(!p) return;
  document.getElementById('modalPecaTitle').textContent = 'Editar peça';
  document.getElementById('pecaId').value = p.id;
  document.getElementById('pecaNome').value = p.nome;
  document.getElementById('pecaQtd').value = p.qtd;
  document.getElementById('pecaMin').value = p.estoque_minimo;
  document.getElementById('pecaCusto').value = p.custo || 0;
  document.getElementById('pecaPreco').value = p.preco;
  populateFornecedorSelect(p.fornecedor_id);
  openModal('overlayPeca');
}

document.getElementById('salvarPecaBtn').addEventListener('click', async ()=>{
  const id = document.getElementById('pecaId').value;
  const nome = document.getElementById('pecaNome').value.trim();
  const qtd = parseInt(document.getElementById('pecaQtd').value) || 0;
  const estoque_minimo = parseInt(document.getElementById('pecaMin').value) || 0;
  const custo = parseFloat(document.getElementById('pecaCusto').value) || 0;
  const preco = parseFloat(document.getElementById('pecaPreco').value) || 0;
  const fornecedor_id = document.getElementById('pecaFornecedor').value || null;
  if(!nome){ alert('Informe o nome da peça.'); return; }
  if(id){
    const { error } = await sb.from('pecas').update({ nome, qtd, estoque_minimo, custo, preco, fornecedor_id }).eq('id', id);
    if(error){ alert('Erro ao salvar peça: ' + error.message); return; }
  } else {
    const { error } = await sb.from('pecas').insert({ empresa_id: empresaId, nome, qtd, estoque_minimo, custo, preco, fornecedor_id });
    if(error){ alert('Erro ao salvar peça: ' + error.message); return; }
  }
  closeModal('overlayPeca');
  await carregarDados();
});

async function excluirPeca(id){
  if(!confirm('Excluir esta peça do estoque?')) return;
  await sb.from('pecas').delete().eq('id', id);
  await carregarDados();
}

function abrirReporEstoque(id){
  const p = data.pecas.find(x=>x.id===id);
  if(!p) return;
  document.getElementById('reporPecaId').value = p.id;
  document.getElementById('reporPecaNomeLabel').textContent = `${p.nome} — estoque atual: ${p.qtd}`;
  document.getElementById('reporQtd').value = '';
  document.getElementById('reporCusto').value = p.custo || '';
  openModal('overlayReporEstoque');
}

document.getElementById('salvarReporBtn').addEventListener('click', async ()=>{
  const id = document.getElementById('reporPecaId').value;
  const p = data.pecas.find(x=>x.id===id);
  if(!p) return;
  const qtdAdicionar = parseInt(document.getElementById('reporQtd').value) || 0;
  const custoUnitario = parseFloat(document.getElementById('reporCusto').value) || 0;
  if(qtdAdicionar <= 0){ alert('Informe uma quantidade maior que zero.'); return; }
  const novaQtd = (p.qtd || 0) + qtdAdicionar;
  const { error: errQtd } = await sb.from('pecas').update({ qtd: novaQtd, custo: custoUnitario }).eq('id', id);
  if(errQtd){ alert('Erro ao atualizar estoque: ' + errQtd.message); return; }
  const { error: errMov } = await sb.from('movimentos_caixa').insert({
    empresa_id: empresaId, tipo: 'saida', categoria: 'estoque',
    descricao: `Reposição de estoque: ${p.nome} x${qtdAdicionar}`,
    valor: qtdAdicionar * custoUnitario, peca_id: id, data: hojeLocal()
  });
  if(errMov){ alert('Erro ao lançar despesa da reposição: ' + errMov.message); return; }
  closeModal('overlayReporEstoque');
  await carregarDados();
});

// ---------------- FORNECEDORES ----------------
document.getElementById('btnNovoFornecedor').addEventListener('click', ()=>{
  document.getElementById('modalFornecedorTitle').textContent = 'Novo fornecedor';
  document.getElementById('fornecedorId').value = '';
  document.getElementById('fornecedorNome').value = '';
  document.getElementById('fornecedorTelefone').value = '';
  document.getElementById('fornecedorGanhaMargem').checked = true;
  openModal('overlayFornecedor');
});

function editFornecedor(id){
  const f = data.fornecedores.find(x=>x.id===id);
  if(!f) return;
  document.getElementById('modalFornecedorTitle').textContent = 'Editar fornecedor';
  document.getElementById('fornecedorId').value = f.id;
  document.getElementById('fornecedorNome').value = f.nome;
  document.getElementById('fornecedorTelefone').value = f.telefone || '';
  document.getElementById('fornecedorGanhaMargem').checked = f.ganha_margem !== false;
  openModal('overlayFornecedor');
}

document.getElementById('salvarFornecedorBtn').addEventListener('click', async ()=>{
  const id = document.getElementById('fornecedorId').value;
  const nome = document.getElementById('fornecedorNome').value.trim();
  const telefone = document.getElementById('fornecedorTelefone').value.trim();
  const ganha_margem = document.getElementById('fornecedorGanhaMargem').checked;
  if(!nome){ alert('Informe o nome do fornecedor.'); return; }
  if(id){
    const { error } = await sb.from('fornecedores').update({ nome, telefone, ganha_margem }).eq('id', id);
    if(error){ alert('Erro ao salvar fornecedor: ' + error.message); return; }
  } else {
    const { error } = await sb.from('fornecedores').insert({ empresa_id: empresaId, nome, telefone, ganha_margem });
    if(error){ alert('Erro ao salvar fornecedor: ' + error.message); return; }
  }
  closeModal('overlayFornecedor');
  await carregarDados();
});

async function excluirFornecedor(id){
  if(!confirm('Excluir este fornecedor? As peças ligadas a ele ficarão sem fornecedor.')) return;
  await sb.from('fornecedores').delete().eq('id', id);
  await carregarDados();
}

function renderFornecedores(){
  const body = document.getElementById('fornecedoresBody');
  const termo = filtroFornecedores;
  const lista = termo ? data.fornecedores.filter(f=>f.nome.toLowerCase().includes(termo) || (f.telefone||'').toLowerCase().includes(termo)) : data.fornecedores;
  if(lista.length===0){ body.innerHTML = `<tr><td colspan="5" class="empty-note">${termo ? 'Nenhum fornecedor encontrado.' : 'Nenhum fornecedor cadastrado ainda.'}</td></tr>`; return; }
  body.innerHTML = lista.map(f=>{
    const nPecas = data.pecas.filter(p=>p.fornecedor_id===f.id).length;
    const margem = f.ganha_margem !== false;
    return `<tr><td>${escapeHtml(f.nome)}</td><td class="mono">${escapeHtml(f.telefone||'—')}</td>
      <td><span class="tag-pill">${margem ? 'Com margem' : 'Sem margem'}</span></td>
      <td><span class="tag-pill">${nPecas} peça${nPecas===1?'':'s'}</span></td>
      <td><div class="row-actions"><button class="btn btn-ghost btn-sm" onclick="editFornecedor('${f.id}')">Editar</button><button class="btn btn-ghost btn-sm" onclick="excluirFornecedor('${f.id}')">Excluir</button></div></td></tr>`;
  }).join('');
}

// ---------------- FUNCIONÁRIOS ----------------
document.getElementById('btnNovoFuncionario').addEventListener('click', ()=>{
  document.getElementById('modalFuncionarioTitle').textContent = 'Novo funcionário';
  document.getElementById('funcionarioId').value = '';
  document.getElementById('funcionarioNome').value = '';
  document.getElementById('funcionarioCargo').value = 'Mecânico';
  document.getElementById('funcionarioTelefone').value = '';
  openModal('overlayFuncionario');
});

function editFuncionario(id){
  const f = data.funcionarios.find(x=>x.id===id);
  if(!f) return;
  document.getElementById('modalFuncionarioTitle').textContent = 'Editar funcionário';
  document.getElementById('funcionarioId').value = f.id;
  document.getElementById('funcionarioNome').value = f.nome;
  document.getElementById('funcionarioCargo').value = f.cargo || 'Mecânico';
  document.getElementById('funcionarioTelefone').value = f.telefone || '';
  openModal('overlayFuncionario');
}

document.getElementById('salvarFuncionarioBtn').addEventListener('click', async ()=>{
  const id = document.getElementById('funcionarioId').value;
  const nome = document.getElementById('funcionarioNome').value.trim();
  const cargo = document.getElementById('funcionarioCargo').value;
  const telefone = document.getElementById('funcionarioTelefone').value.trim();
  if(!nome){ alert('Informe o nome do funcionário.'); return; }
  if(id){
    const { error } = await sb.from('funcionarios').update({ nome, cargo, telefone }).eq('id', id);
    if(error){ alert('Erro ao salvar funcionário: ' + error.message); return; }
  } else {
    const { error } = await sb.from('funcionarios').insert({ empresa_id: empresaId, nome, cargo, telefone });
    if(error){ alert('Erro ao salvar funcionário: ' + error.message); return; }
  }
  closeModal('overlayFuncionario');
  await carregarDados();
});

async function excluirFuncionario(id){
  if(!confirm('Excluir este funcionário? As OS que já registraram ele como responsável mantêm o histórico, só perdem esse vínculo.')) return;
  await sb.from('funcionarios').delete().eq('id', id);
  await carregarDados();
}

document.getElementById('buscaFuncionarios').addEventListener('input', (e)=>{ filtroFuncionarios = e.target.value.trim().toLowerCase(); renderFuncionarios(); });

function populateFuncionarioSelect(selectedId){
  const sel = document.getElementById('osFuncionario');
  sel.innerHTML = '<option value="">Não informado</option>' + data.funcionarios.map(f=>`<option value="${f.id}">${escapeHtml(f.nome)} (${escapeHtml(f.cargo)})</option>`).join('');
  sel.value = selectedId || '';
}

function renderFuncionarios(){
  const wrap = document.getElementById('funcionariosLista');
  const termo = filtroFuncionarios;
  const lista = termo ? data.funcionarios.filter(f=>f.nome.toLowerCase().includes(termo) || (f.cargo||'').toLowerCase().includes(termo)) : data.funcionarios;
  if(lista.length===0){
    wrap.innerHTML = `<div class="empty-note">${termo ? 'Nenhum funcionário encontrado.' : 'Nenhum funcionário cadastrado ainda.'}</div>`;
    return;
  }
  wrap.innerHTML = lista.map(f=>{
    const nOS = data.os.filter(o=>o.funcionario_id===f.id).length;
    return `<div class="cliente-card">
      <div class="cliente-card-header">
        <div>
          <div class="cliente-card-nome">${escapeHtml(f.nome)} <span class="tag-pill ativo-pill">${escapeHtml(f.cargo)}</span></div>
          <div class="cliente-card-info">${f.telefone ? escapeHtml(f.telefone)+' · ' : ''}${nOS} OS registrada${nOS===1?'':'s'}</div>
        </div>
        <div class="cliente-card-acoes">
          <button class="btn btn-ghost btn-sm" onclick="editFuncionario('${f.id}')">Editar</button>
          <button class="btn btn-ghost btn-sm" onclick="excluirFuncionario('${f.id}')">Excluir</button>
        </div>
      </div>
    </div>`;
  }).join('');
}
document.getElementById('salvarOficinaBtn').addEventListener('click', async ()=>{
  const nome = document.getElementById('oficinaNome').value.trim();
  const cnpj = document.getElementById('oficinaCnpj').value.trim();
  const telefone = document.getElementById('oficinaTelefone').value.trim();
  if(!nome){ alert('Informe o nome da oficina.'); return; }
  const { error } = await sb.from('empresas').update({ nome, cnpj, telefone }).eq('id', empresaId);
  if(error){ alert('Erro ao salvar dados da oficina: ' + error.message); return; }
  empresaNome = nome;
  document.getElementById('empresaNomeLabel').textContent = nome;
  renderAll();
  alert('Dados da oficina atualizados!');
});

// ---------------- HELPERS ----------------
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function hojeLocal(){
  const d = new Date();
  const ano = d.getFullYear();
  const mes = String(d.getMonth()+1).padStart(2,'0');
  const dia = String(d.getDate()).padStart(2,'0');
  return `${ano}-${mes}-${dia}`;
}
function diasAte(dataStr){ if(!dataStr) return null; const hoje = new Date(); hoje.setHours(0,0,0,0); const alvo = new Date(dataStr+'T00:00:00'); return Math.round((alvo - hoje) / 86400000); }
function waLink(telefone, mensagem){ const digits = (telefone||'').replace(/\D/g,''); const withCountry = digits.startsWith('55') ? digits : '55'+digits; return `https://wa.me/${withCountry}?text=${encodeURIComponent(mensagem)}`; }
function formatBRL(v){ return 'R$ ' + Number(v||0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// ---------------- RENDER ----------------
function renderAll(){ renderPainel(); renderClientes(); renderPecas(); renderFornecedores(); renderFuncionarios(); renderOS(); renderFinanceiro(); }

function painelRowHtml(v, cliente, dias, opts){
  const overdue = dias < 0;
  const statusLabel = overdue ? `${Math.abs(dias)} dia${Math.abs(dias)===1?'':'s'} vencida` : (dias===0 ? 'Vence hoje' : `Vence em ${dias} dia${dias===1?'':'s'}`);
  const nomeCliente = cliente ? cliente.nome : 'Cliente não vinculado';
  const telefone = cliente ? cliente.telefone : '';
  const avisos = v.contatos_count || 0;
  const msg = `Olá, ${nomeCliente.split(' ')[0]}! Aqui é da ${empresaNome}. A revisão do seu ${v.modelo} (placa ${v.placa}) está ${overdue ? 'vencida' : 'próxima do vencimento'}. Podemos agendar um horário para você?`;
  const waButton = telefone
    ? `<a class="wa-btn btn-sm" href="${waLink(telefone, msg)}" target="_blank" rel="noopener" onclick="marcarContatado('${v.id}')">${opts.contatado||opts.semRetorno ? 'Chamar de novo' : 'Chamar no WhatsApp'}</a>`
    : `<span class="tag-pill">sem telefone</span>`;
  const btnConcluir = `<button class="btn btn-ghost btn-sm" onclick="marcarRevisaoFeita('${v.id}')" title="Agendou / revisão feita">✓ Concluir</button>`;

  if(opts.semRetorno){
    return `<div class="painel-row">
      <div class="pr-veiculo"><span class="pr-veiculo-icon">🚗</span><div><div class="pr-cliente">${escapeHtml(nomeCliente)}</div><div class="pr-modelo">${escapeHtml(v.modelo||'')}</div></div></div>
      <div><span class="plate">${escapeHtml(v.placa||'---')}</span></div>
      <div class="aviso-count">${avisos}/${LIMITE_AVISOS} avisos enviados</div>
      <div class="pr-acoes">${waButton}<button class="btn btn-ghost btn-sm" onclick="reabrirFila('${v.id}')">Reabrir na fila</button></div>
    </div>`;
  }

  if(opts.contatado){
    return `<div class="painel-row">
      <div class="pr-veiculo"><span class="pr-veiculo-icon">🚗</span><div><div class="pr-cliente">${escapeHtml(nomeCliente)}</div><div class="pr-modelo">${escapeHtml(v.modelo||'')}</div></div></div>
      <div><span class="plate">${escapeHtml(v.placa||'---')}</span></div>
      <div class="aviso-count">${avisos}/${LIMITE_AVISOS} avisos · avisado há ${opts.diasContato} dia${opts.diasContato===1?'':'s'}</div>
      <div class="pr-acoes">${waButton}${btnConcluir}</div>
    </div>`;
  }

  return `<div class="painel-row">
    <div class="pr-veiculo"><span class="pr-veiculo-icon">🚗</span><div><div class="pr-cliente">${escapeHtml(nomeCliente)}</div><div class="pr-modelo">${escapeHtml(v.modelo||'')}</div></div></div>
    <div><span class="plate">${escapeHtml(v.placa||'---')}</span></div>
    <div><span class="tag-status ${overdue?'overdue':'soon'}">${statusLabel}</span></div>
    <div class="pr-acoes">${waButton}${btnConcluir}</div>
  </div>`;
}

function renderPainelPaginado(containerId, paginacaoId, itens, chavePagina, montarLinha){
  const totalPaginas = Math.max(1, Math.ceil(itens.length / PAINEL_PAGE_SIZE));
  if(painelPaginas[chavePagina] > totalPaginas) painelPaginas[chavePagina] = totalPaginas;
  const pagina = painelPaginas[chavePagina];
  const inicio = (pagina-1) * PAINEL_PAGE_SIZE;
  const itensPagina = itens.slice(inicio, inicio + PAINEL_PAGE_SIZE);

  const container = document.getElementById(containerId);
  container.innerHTML = itensPagina.length === 0
    ? `<div class="empty-note">Nada por aqui.</div>`
    : itensPagina.map(montarLinha).join('');

  const pagWrap = document.getElementById(paginacaoId);
  if(itens.length <= PAINEL_PAGE_SIZE){ pagWrap.innerHTML = ''; return; }
  pagWrap.innerHTML = `
    <button ${pagina<=1?'disabled':''} onclick="mudarPaginaPainel('${chavePagina}',${pagina-1})">‹</button>
    <span class="pg-atual">${pagina}</span>
    <button ${pagina>=totalPaginas?'disabled':''} onclick="mudarPaginaPainel('${chavePagina}',${pagina+1})">›</button>
  `;
}

function mudarPaginaPainel(chave, novaPagina){
  painelPaginas[chave] = novaPagina;
  renderPainel();
}

async function atualizarStatusFila(){
  const updates = [];
  data.veiculos.forEach(v=>{
    if(!v.proxima_revisao || v.sem_retorno) return;
    const diasContato = v.ultimo_contato ? diasAte(v.ultimo_contato) * -1 : null;
    const passouEspera = diasContato !== null && diasContato >= DIAS_AGUARDANDO_RETORNO;
    if(passouEspera && (v.contatos_count||0) >= LIMITE_AVISOS){
      v.sem_retorno = true;
      updates.push(sb.from('veiculos').update({ sem_retorno: true }).eq('id', v.id));
    }
  });
  if(updates.length) await Promise.all(updates);
}

async function renderPainel(){
  await atualizarStatusFila();
  const linhas = data.veiculos
    .filter(v=>v.proxima_revisao)
    .map(v=>{
      const dias = diasAte(v.proxima_revisao);
      const cliente = data.clientes.find(c=>c.id===v.cliente_id);
      const diasContato = v.ultimo_contato ? diasAte(v.ultimo_contato) * -1 : null;
      const aguardandoRetorno = v.ultimo_contato && diasContato !== null && diasContato < DIAS_AGUARDANDO_RETORNO;
      return { v, cliente, dias, diasContato, aguardandoRetorno, semRetorno: !!v.sem_retorno };
    })
    .filter(x=>x.dias !== null && x.dias <= 30)
    .sort((a,b)=>a.dias-b.dias);

  const semRetorno = linhas.filter(x=>x.semRetorno);
  const ativos = linhas.filter(x=>!x.semRetorno);
  const fila = ativos.filter(x=>!x.aguardandoRetorno);
  const aguardando = ativos.filter(x=>x.aguardandoRetorno);
  const vencidas = fila.filter(x=>x.dias < 0);
  const proximas = fila.filter(x=>x.dias >= 0);

  document.getElementById('statVencidas').textContent = vencidas.length;
  document.getElementById('statProximas').textContent = proximas.length;
  document.getElementById('statClientes').textContent = data.clientes.length;
  document.getElementById('statOSPendentes').textContent = data.os.filter(o=>o.status==='pendente' && !o.cancelada).length;
  document.getElementById('statOSEmAndamento').textContent = data.os.filter(o=>o.status==='em_andamento' && !o.cancelada).length;

  renderPainelPaginado('filaVencidasProximas', 'paginacaoFila', fila, 'fila',
    ({v,cliente,dias})=>painelRowHtml(v,cliente,dias,{contatado:false}));
  renderPainelPaginado('filaAguardando', 'paginacaoAguardando', aguardando, 'aguardando',
    ({v,cliente,dias,diasContato})=>painelRowHtml(v,cliente,dias,{contatado:true,diasContato}));
  renderPainelPaginado('filaSemRetorno', 'paginacaoSemRetorno', semRetorno, 'semRetorno',
    ({v,cliente,dias})=>painelRowHtml(v,cliente,dias,{semRetorno:true}));
}

function renderClientes(){
  const wrap = document.getElementById('clientesLista');
  const termo = filtroClientes;

  let lista = data.clientes;
  if(filtroStatusCliente){
    lista = lista.filter(c=> filtroStatusCliente === 'ativo' ? c.ativo !== false : c.ativo === false);
  }
  if(termo){
    lista = lista.filter(c=>{
      const veiculosCliente = data.veiculos.filter(v=>v.cliente_id===c.id);
      const bateVeiculo = veiculosCliente.some(v=>(v.placa||'').toLowerCase().includes(termo) || (v.modelo||'').toLowerCase().includes(termo));
      return c.nome.toLowerCase().includes(termo)
        || (c.cpf||'').toLowerCase().includes(termo)
        || (c.telefone||'').toLowerCase().includes(termo)
        || (c.email||'').toLowerCase().includes(termo)
        || bateVeiculo;
    });
  }

  if(lista.length===0){
    wrap.innerHTML = `<div class="empty-note">${termo ? 'Nenhum cliente ou veículo encontrado.' : 'Nenhum cliente cadastrado ainda.'}</div>`;
    return;
  }

  wrap.innerHTML = lista.map(c=>{
    const veiculosCliente = data.veiculos.filter(v=>v.cliente_id===c.id);
    const infoPartes = [c.cpf ? `CPF ${escapeHtml(c.cpf)}` : null, c.telefone ? escapeHtml(c.telefone) : null, c.email ? escapeHtml(c.email) : null].filter(Boolean);

    const veiculosHtml = veiculosCliente.length === 0
      ? `<div class="sem-veiculos-note">Nenhum veículo cadastrado para este cliente.</div>`
      : veiculosCliente.map(v=>{
          const dias = diasAte(v.proxima_revisao);
          let anoLabel = '';
          if(v.ano_fabricacao || v.ano_modelo){
            anoLabel = ` ${v.ano_fabricacao||'?'}/${v.ano_modelo||'?'}`;
          }
          let revisaoLabel = '';
          if(v.proxima_revisao){
            const d = new Date(v.proxima_revisao+'T00:00:00');
            revisaoLabel = ` · próxima revisão ${d.toLocaleDateString('pt-BR')}${dias<0 ? ' (vencida)' : ''}`;
          }
          return `<div class="veiculo-item">
            <div class="veiculo-item-info">
              <span class="plate" style="min-width:64px;padding:3px 7px;font-size:11.5px;">${escapeHtml(v.placa||'---')}</span>
              <span>${escapeHtml(v.modelo||'')}${anoLabel}${revisaoLabel}</span>
            </div>
            <div class="veiculo-item-acoes">
              <button class="btn btn-ghost btn-sm" onclick="abrirModalOS('${c.id}','${v.id}')">Nova OS</button>
              <button class="btn btn-ghost btn-sm" onclick="editVeiculo('${v.id}')">Editar</button>
              <button class="btn btn-ghost btn-sm" onclick="excluirVeiculo('${v.id}')">Excluir</button>
            </div>
          </div>`;
        }).join('');

    return `<div class="cliente-card${c.ativo===false ? ' cliente-inativo' : ''}">
      <div class="cliente-card-header">
        <div>
          <div class="cliente-card-nome">${escapeHtml(c.nome)} <span class="tag-pill ${c.ativo===false ? '' : 'ativo-pill'}">${c.ativo===false ? 'Inativo' : 'Ativo'}</span></div>
          <div class="cliente-card-info">${infoPartes.join(' · ') || 'sem CPF, telefone ou e-mail cadastrado'}</div>
        </div>
        <div class="cliente-card-acoes">
          <button class="btn btn-sm" onclick="abrirModalVeiculo('${c.id}')">+ Veículo</button>
          <button class="btn btn-ghost btn-sm" onclick="lembrarRetorno('${c.id}')">Lembrar retorno</button>
          <button class="btn btn-ghost btn-sm" onclick="toggleClienteAtivo('${c.id}')">${c.ativo===false ? 'Ativar' : 'Inativar'}</button>
          <button class="btn btn-ghost btn-sm" onclick="editCliente('${c.id}')">Editar</button>
          <button class="btn btn-ghost btn-sm" onclick="excluirCliente('${c.id}')">Excluir</button>
        </div>
      </div>
      <div class="veiculos-do-cliente">${veiculosHtml}</div>
    </div>`;
  }).join('');
}

function renderPecas(){
  const body = document.getElementById('pecasBody');
  const termo = filtroPecas;
  const lista = termo ? data.pecas.filter(p=>p.nome.toLowerCase().includes(termo)) : data.pecas;
  if(lista.length===0){ body.innerHTML = `<tr><td colspan="5" class="empty-note">${termo ? 'Nenhuma peça encontrada.' : 'Nenhuma peça cadastrada ainda.'}</td></tr>`; return; }
  body.innerHTML = lista.map(p=>{
    const baixo = p.qtd <= p.estoque_minimo;
    const fornecedor = data.fornecedores.find(f=>f.id===p.fornecedor_id);
    let fornecedorCell = '<span class="tag-pill">sem fornecedor</span>';
    if(fornecedor){
      if(fornecedor.telefone){
        const msg = `Olá, ${fornecedor.nome}! Preciso repor a peça "${p.nome}" no meu estoque. Você tem disponível?`;
        fornecedorCell = `${escapeHtml(fornecedor.nome)} <a class="wa-btn btn-sm" style="margin-left:6px;" href="${waLink(fornecedor.telefone, msg)}" target="_blank" rel="noopener">WhatsApp</a>`;
      } else {
        fornecedorCell = escapeHtml(fornecedor.nome);
      }
    }
    return `<tr><td>${escapeHtml(p.nome)}</td><td class="${baixo?'low-stock':''}">${p.qtd}${baixo ? ' · estoque baixo' : ''}</td>
      <td>${fornecedorCell}</td>
      <td class="mono">R$ ${Number(p.preco).toFixed(2)}</td>
      <td><div class="row-actions"><button class="btn btn-ghost btn-sm" onclick="abrirReporEstoque('${p.id}')">Repor</button><button class="btn btn-ghost btn-sm" onclick="editPeca('${p.id}')">Editar</button><button class="btn btn-ghost btn-sm" onclick="excluirPeca('${p.id}')">Excluir</button></div></td></tr>`;
  }).join('');
}

// ---------------- BARRA LATERAL ----------------
const sidebarEl = document.getElementById('sidebar');
const btnToggleSidebar = document.getElementById('btnToggleSidebar');
function aplicarEstadoSidebar(recolhida){
  sidebarEl.classList.toggle('collapsed', recolhida);
  btnToggleSidebar.textContent = recolhida ? '›' : '‹';
  btnToggleSidebar.title = recolhida ? 'Expandir menu' : 'Recolher menu';
}
aplicarEstadoSidebar(localStorage.getItem('torque_sidebar_recolhida') === '1');
btnToggleSidebar.addEventListener('click', ()=>{
  const recolhida = !sidebarEl.classList.contains('collapsed');
  aplicarEstadoSidebar(recolhida);
  localStorage.setItem('torque_sidebar_recolhida', recolhida ? '1' : '0');
});

// ---------------- NOVA EMPRESA (usuário já autenticado) ----------------
let usuarioIdAtual = null;
let novaEmpresaId = null;

function renderMinhasEmpresas(){
  const lista = document.getElementById('minhasEmpresasLista');
  lista.replaceChildren();
  vinculosAtivosAtual.forEach(vinculo=>{
    const item = document.createElement('div');
    item.className = 'minha-empresa-item' + (vinculo.empresa_id === contextoEmpresa.empresaId ? ' ativa' : '');
    const nomeEl = document.createElement('span');
    nomeEl.textContent = vinculo.empresa.nome;
    const papelEl = document.createElement('span');
    papelEl.className = 'minha-empresa-papel';
    papelEl.textContent = vinculo.papel;
    item.appendChild(nomeEl);
    item.appendChild(papelEl);
    lista.appendChild(item);
  });
}

function usuarioPodeGerenciarVinculos(){
  return !!contextoEmpresa && ['proprietario', 'admin'].includes(contextoEmpresa.papel);
}

function nomePapelUsuario(papel){
  const nomes = {
    proprietario: 'Proprietário',
    admin: 'Administrador',
    gerente: 'Gerente',
    usuario: 'Usuário'
  };
  return nomes[papel] || papel;
}

// Mesma matriz de hierarquia usada tanto para "Remover acesso" (vínculos
// ativos) quanto para "Reativar acesso" (vínculos inativos, onde o papel a
// reativar é travado no papel anterior do vínculo) - em ambos os casos a
// pergunta é idêntica: "o papel do chamador tem autoridade sobre este
// papel específico?". proprietario nunca é alvo em nenhum dos dois fluxos.
function usuarioPodeRemoverAlvo(papelChamador, papelAlvo){
  const papeisRemoviveis = {
    proprietario: ['admin', 'gerente', 'usuario'],
    admin: ['gerente', 'usuario']
  };
  return (papeisRemoviveis[papelChamador] || []).includes(papelAlvo);
}

function renderUsuariosEmpresa(usuarios){
  const body = document.getElementById('usuariosEmpresaBody');
  body.replaceChildren();

  usuarios.forEach(usuario=>{
    const tr = document.createElement('tr');
    const emailTd = document.createElement('td');
    const papelTd = document.createElement('td');
    const statusTd = document.createElement('td');
    const acoesTd = document.createElement('td');
    const papel = document.createElement('span');
    const status = document.createElement('span');

    emailTd.textContent = usuario.email;
    papel.className = 'tag-pill';
    papel.textContent = nomePapelUsuario(usuario.papel);
    status.className = 'tag-pill ' + (usuario.ativo ? 'ativo-pill' : 'usuario-inativo-pill');
    status.textContent = usuario.ativo ? 'Ativo' : 'Inativo';

    papelTd.appendChild(papel);
    statusTd.appendChild(status);

    // "Remover acesso" só em vínculos ativos e só quando o papel do
    // chamador tem permissão sobre o papel do alvo (proprietario nunca
    // aparece como alvo aqui — saída do próprio proprietário é um fluxo
    // separado, fora do escopo deste incremento).
    if(usuario.ativo && usuarioPodeRemoverAlvo(contextoEmpresa.papel, usuario.papel)){
      const acoes = document.createElement('div');
      acoes.className = 'row-actions';
      const removerBtn = document.createElement('button');
      removerBtn.type = 'button';
      removerBtn.className = 'btn btn-ghost btn-sm';
      removerBtn.textContent = 'Remover acesso';
      removerBtn.addEventListener('click', ()=>abrirConfirmacaoRemoverUsuario(usuario.vinculo_id));
      acoes.appendChild(removerBtn);
      acoesTd.appendChild(acoes);
    } else if(!usuario.ativo && usuarioPodeRemoverAlvo(contextoEmpresa.papel, usuario.papel)){
      // "Reativar acesso" só em vínculos inativos, com a mesma matriz de
      // hierarquia acima aplicada ao papel ANTERIOR do vínculo — o modal
      // reutilizado trava o papel nesse mesmo valor (sem opção de trocar),
      // então esta condição de exibição já prevê exatamente o que a RPC
      // vai aceitar.
      const acoes = document.createElement('div');
      acoes.className = 'row-actions';
      const reativarBtn = document.createElement('button');
      reativarBtn.type = 'button';
      reativarBtn.className = 'btn btn-ghost btn-sm';
      reativarBtn.textContent = 'Reativar acesso';
      reativarBtn.addEventListener('click', ()=>abrirModalReativarUsuario(usuario.vinculo_id));
      acoes.appendChild(reativarBtn);
      acoesTd.appendChild(acoes);
    }

    tr.appendChild(emailTd);
    tr.appendChild(papelTd);
    tr.appendChild(statusTd);
    tr.appendChild(acoesTd);
    body.appendChild(tr);
  });
}

function filtrarUsuariosEmpresa(lista){
  const busca = document.getElementById('usuariosEmpresaBuscaEmail').value.trim().toLowerCase();
  const status = document.getElementById('usuariosEmpresaFiltroStatus').value;
  const papel = document.getElementById('usuariosEmpresaFiltroPapel').value;

  return lista.filter(usuario=>{
    if(busca && !(usuario.email || '').toLowerCase().includes(busca)) return false;
    if(status === 'ativos' && !usuario.ativo) return false;
    if(status === 'inativos' && usuario.ativo) return false;
    if(papel && usuario.papel !== papel) return false;
    return true;
  });
}

// Aplicação puramente local, sobre usuariosEmpresaListaAtual (já carregada
// via RPC) — busca/status/papel nunca disparam uma nova chamada de rede.
function aplicarFiltrosUsuariosEmpresa(){
  const status = document.getElementById('usuariosEmpresaStatus');
  const tableWrap = document.getElementById('usuariosEmpresaTableWrap');

  if(usuariosEmpresaListaAtual.length === 0){
    status.textContent = 'Nenhum usuário vinculado a esta empresa.';
    status.classList.remove('hidden', 'usuarios-empresa-error');
    tableWrap.classList.add('hidden');
    return;
  }

  const filtrados = filtrarUsuariosEmpresa(usuariosEmpresaListaAtual);
  if(filtrados.length === 0){
    status.textContent = 'Não foram encontrados usuários com os filtros selecionados.';
    status.classList.remove('hidden', 'usuarios-empresa-error');
    tableWrap.classList.add('hidden');
    return;
  }

  renderUsuariosEmpresa(filtrados);
  status.classList.add('hidden');
  tableWrap.classList.remove('hidden');
}
document.getElementById('usuariosEmpresaBuscaEmail').addEventListener('input', aplicarFiltrosUsuariosEmpresa);
document.getElementById('usuariosEmpresaFiltroStatus').addEventListener('change', aplicarFiltrosUsuariosEmpresa);
document.getElementById('usuariosEmpresaFiltroPapel').addEventListener('change', aplicarFiltrosUsuariosEmpresa);

async function carregarUsuariosEmpresa(){
  const section = document.getElementById('usuariosEmpresaSection');
  if(!usuarioPodeGerenciarVinculos()){
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  if(usuariosEmpresaCarregados || usuariosEmpresaCarregando) return;
  usuariosEmpresaCarregando = true;

  const status = document.getElementById('usuariosEmpresaStatus');
  const tableWrap = document.getElementById('usuariosEmpresaTableWrap');
  status.textContent = 'Carregando usuários…';
  status.classList.remove('hidden', 'usuarios-empresa-error');
  tableWrap.classList.add('hidden');

  try{
    let usuarios;
    let error;
    try{
      ({ data: usuarios, error } = await sb.rpc('listar_usuarios_empresa', {
        p_empresa_id: empresaId
      }));
    } catch(erroInesperado){
      status.textContent = 'Não foi possível carregar os usuários. Tente novamente.';
      status.classList.add('usuarios-empresa-error');
      return;
    }

    if(error){
      const mensagens = {
        PGRST202: 'A listagem de usuários ainda precisa ser ativada no banco de dados.',
        TRQ55: 'Você não tem mais permissão para ver os usuários desta empresa.'
      };
      status.textContent = mensagens[error.code] || 'Não foi possível carregar os usuários. Tente novamente.';
      status.classList.add('usuarios-empresa-error');
      return;
    }

    usuariosEmpresaCarregados = true;
    usuariosEmpresaListaAtual = usuarios || [];
    aplicarFiltrosUsuariosEmpresa();
  } finally {
    usuariosEmpresaCarregando = false;
  }
}

function mostrarFeedbackUsuariosEmpresa(mensagem){
  const el = document.getElementById('usuariosEmpresaFeedback');
  el.textContent = mensagem;
  el.classList.remove('hidden');
}

function montarOpcoesPapelAdicionarUsuario(){
  const select = document.getElementById('adicionarUsuarioPapel');
  select.replaceChildren();
  // 'proprietario' nunca é oferecido aqui — o fluxo "Adicionar usuário"
  // não pode atribuir esse papel (regra TRQ28); transferência de
  // propriedade terá um fluxo separado e mais protegido no futuro.
  const papeis = contextoEmpresa.papel === 'proprietario'
    ? ['admin', 'gerente', 'usuario']
    : ['gerente', 'usuario'];
  papeis.forEach(papel=>{
    const option = document.createElement('option');
    option.value = papel;
    option.textContent = nomePapelUsuario(papel);
    select.appendChild(option);
  });
}

function abrirModalAdicionarUsuario(){
  // Guarda defensiva de frontend: a segurança real fica na RPC (TRQ25),
  // isto só evita abrir o modal por uma chamada acidental quando o botão
  // que o dispara já deveria estar oculto para o papel atual.
  if(!usuarioPodeGerenciarVinculos()) return;
  vinculoIdParaReativar = null;
  document.getElementById('adicionarUsuarioTitulo').textContent = 'Adicionar usuário';
  const emailInput = document.getElementById('adicionarUsuarioEmail');
  emailInput.value = '';
  emailInput.disabled = false;
  document.getElementById('adicionarUsuarioError').classList.add('hidden');
  document.getElementById('usuariosEmpresaFeedback').classList.add('hidden');
  montarOpcoesPapelAdicionarUsuario();
  document.getElementById('adicionarUsuarioPapel').disabled = false;
  document.getElementById('adicionarUsuarioSubmitBtn').textContent = 'Adicionar usuário';
  document.getElementById('adicionarUsuarioSubmitBtn').disabled = false;
  document.getElementById('adicionarUsuarioCancelarBtn').disabled = false;
  openModal('overlayAdicionarUsuario');
}
document.getElementById('adicionarUsuarioBtn').addEventListener('click', abrirModalAdicionarUsuario);

// Guarda defensiva de frontend (NÃO substitui a segurança real, que é da
// RPC incluir_usuario_empresa): confirma que o vínculo ainda existe em
// usuariosEmpresaListaAtual, que continua INATIVO, e que o papel atual do
// chamador tem permissão sobre o papel ANTERIOR do alvo (mesma matriz usada
// em "Remover acesso" - aqui o papel fica travado nesse valor anterior, sem
// opção de escolher outro).
function validarReativacaoUsuarioEmpresa(vinculoId){
  if(!vinculoId) return null;
  const alvo = usuariosEmpresaListaAtual.find(u=>u.vinculo_id === vinculoId);
  if(!alvo || alvo.ativo) return null;
  if(!usuarioPodeRemoverAlvo(contextoEmpresa.papel, alvo.papel)) return null;
  return alvo;
}

// Reutiliza o modal "Adicionar usuário" em modo reativação: e-mail e papel
// vêm preenchidos e bloqueados a partir do vínculo inativo clicado (este
// fluxo nunca troca o papel) - a confirmação do envio é o próprio clique no
// botão do modal, como já ocorre em "Adicionar usuário" e "Remover acesso".
function abrirModalReativarUsuario(vinculoId){
  const alvo = validarReativacaoUsuarioEmpresa(vinculoId);
  if(!alvo) return;

  vinculoIdParaReativar = vinculoId;
  document.getElementById('adicionarUsuarioTitulo').textContent = 'Reativar acesso';
  document.getElementById('adicionarUsuarioError').classList.add('hidden');
  document.getElementById('usuariosEmpresaFeedback').classList.add('hidden');

  const emailInput = document.getElementById('adicionarUsuarioEmail');
  emailInput.value = alvo.email;
  emailInput.disabled = true;

  const papelSelect = document.getElementById('adicionarUsuarioPapel');
  papelSelect.replaceChildren();
  const option = document.createElement('option');
  option.value = alvo.papel;
  option.textContent = nomePapelUsuario(alvo.papel);
  papelSelect.appendChild(option);
  papelSelect.disabled = true;

  document.getElementById('adicionarUsuarioSubmitBtn').textContent = 'Reativar acesso';
  document.getElementById('adicionarUsuarioSubmitBtn').disabled = false;
  document.getElementById('adicionarUsuarioCancelarBtn').disabled = false;
  openModal('overlayAdicionarUsuario');
}

document.getElementById('adicionarUsuarioCancelarBtn').addEventListener('click', ()=>{
  if(adicionandoUsuarioEmpresa) return;
  vinculoIdParaReativar = null;
  closeModal('overlayAdicionarUsuario');
});

function mostrarErroAdicionarUsuario(erro){
  const el = document.getElementById('adicionarUsuarioError');
  const codigo = erro && erro.code;
  const mensagens = {
    TRQ24: 'Informe um e-mail e um papel válidos.',
    TRQ25: 'Você não tem permissão para incluir esse papel.',
    TRQ26: 'Este e-mail já possui vínculo ativo nesta empresa.',
    TRQ27: 'Nenhuma conta foi encontrada com esse e-mail. A pessoa precisa criar uma conta na Torque antes de ser incluída.',
    TRQ28: 'O papel Proprietário não pode ser atribuído por este fluxo.',
    ESTADO_DESATUALIZADO: 'Este vínculo não está mais disponível para reativação. Atualize a lista e tente novamente.',
    CONFIRMACAO_REATIVACAO_FALHOU: 'Não foi possível confirmar a reativação deste vínculo. Atualize a página e verifique o estado atual antes de tentar novamente.'
  };
  const mensagemGenerica = vinculoIdParaReativar
    ? 'Não foi possível reativar o acesso agora. Tente novamente.'
    : 'Não foi possível concluir a inclusão agora. Tente novamente.';
  el.textContent = mensagens[codigo] || mensagemGenerica;
  el.classList.remove('hidden');
}

document.getElementById('adicionarUsuarioSubmitBtn').addEventListener('click', async ()=>{
  if(adicionandoUsuarioEmpresa) return;

  const errEl = document.getElementById('adicionarUsuarioError');
  errEl.classList.add('hidden');

  const modoReativacao = !!vinculoIdParaReativar;

  // Modo reativação: e-mail e papel NÃO vêm dos campos do modal (que só
  // exibem, travados) - vêm de uma revalidação contra o estado atual de
  // usuariosEmpresaListaAtual, feita imediatamente antes da chamada, para
  // não confiar num vínculo que pode ter mudado (ex.: removido de novo, ou
  // papel do próprio chamador alterado) entre a abertura do modal e este
  // clique.
  let alvoReativacao = null;
  if(modoReativacao){
    alvoReativacao = validarReativacaoUsuarioEmpresa(vinculoIdParaReativar);
    if(!alvoReativacao){
      mostrarErroAdicionarUsuario({ code: 'ESTADO_DESATUALIZADO' });
      return;
    }
  }

  // Modo adicionar: só remove espaços nas pontas — nunca altera
  // maiúsculas/minúsculas do e-mail digitado; a comparação case-insensitive
  // é feita pela RPC.
  const email = modoReativacao ? alvoReativacao.email : document.getElementById('adicionarUsuarioEmail').value.trim();
  const papel = modoReativacao ? alvoReativacao.papel : document.getElementById('adicionarUsuarioPapel').value;

  if(!email || !papel){ mostrarErroAdicionarUsuario({ code: 'TRQ24' }); return; }

  const submitBtn = document.getElementById('adicionarUsuarioSubmitBtn');
  const cancelBtn = document.getElementById('adicionarUsuarioCancelarBtn');
  adicionandoUsuarioEmpresa = true;
  submitBtn.disabled = true;
  cancelBtn.disabled = true;

  try{
    const { data: resultadoRpc, error } = await sb.rpc('incluir_usuario_empresa', {
      p_empresa_id: empresaId,
      p_email: email,
      p_papel: papel
    });

    if(error){
      mostrarErroAdicionarUsuario(error);
      return;
    }

    const resultado = Array.isArray(resultadoRpc) ? resultadoRpc[0] : resultadoRpc;
    if(!resultado || !resultado.vinculo_id){
      mostrarErroAdicionarUsuario({ code: null });
      return;
    }

    // Confirmação pós-chamada específica do modo reativação: a RPC deve ter
    // reativado (não inserido) e deve ter agido sobre o MESMO vinculo_id
    // que abriu o modal - qualquer divergência não é tratada como sucesso.
    if(modoReativacao && (resultado.reativado !== true || resultado.vinculo_id !== vinculoIdParaReativar)){
      mostrarErroAdicionarUsuario({ code: 'CONFIRMACAO_REATIVACAO_FALHOU' });
      usuariosEmpresaCarregados = false;
      await carregarUsuariosEmpresa();
      return;
    }

    closeModal('overlayAdicionarUsuario');
    document.getElementById('adicionarUsuarioEmail').value = '';
    vinculoIdParaReativar = null;

    // Força uma nova busca em carregarUsuariosEmpresa() (que, por padrão,
    // só busca uma vez por carregamento de página). Se essa recarga falhar,
    // o erro fica isolado em #usuariosEmpresaStatus — não sobrescreve a
    // mensagem de sucesso da inclusão, mostrada logo abaixo.
    usuariosEmpresaCarregados = false;
    await carregarUsuariosEmpresa();

    mostrarFeedbackUsuariosEmpresa(resultado.reativado ? 'Vínculo reativado com sucesso.' : 'Usuário incluído com sucesso.');
  } catch(erroInesperado){
    mostrarErroAdicionarUsuario({ code: null });
  } finally {
    adicionandoUsuarioEmpresa = false;
    submitBtn.disabled = false;
    cancelBtn.disabled = false;
  }
});

// Guarda defensiva de frontend (NÃO substitui a segurança real, que é da
// RPC): confirma que o vínculo ainda existe em usuariosEmpresaListaAtual,
// que continua ativo, que vinculoId é um valor válido, e que o papel atual
// do chamador ainda tem permissão sobre o papel do alvo — reduz o risco de
// abrir/confirmar a remoção com um estado de tela desatualizado (ex.: outra
// aba já removeu o mesmo vínculo, ou o papel do chamador mudou).
function validarRemocaoUsuarioEmpresa(vinculoId){
  if(!vinculoId) return null;
  const alvo = usuariosEmpresaListaAtual.find(u=>u.vinculo_id === vinculoId);
  if(!alvo || !alvo.ativo) return null;
  if(!usuarioPodeRemoverAlvo(contextoEmpresa.papel, alvo.papel)) return null;
  return alvo;
}

function abrirConfirmacaoRemoverUsuario(vinculoId){
  const alvo = validarRemocaoUsuarioEmpresa(vinculoId);
  if(!alvo) return;
  vinculoIdParaRemover = vinculoId;
  document.getElementById('removerUsuarioEmailAlvo').textContent = alvo.email;
  document.getElementById('removerUsuarioError').classList.add('hidden');
  document.getElementById('removerUsuarioConfirmarBtn').disabled = false;
  document.getElementById('removerUsuarioCancelarBtn').disabled = false;
  openModal('overlayRemoverUsuario');
}
document.getElementById('removerUsuarioCancelarBtn').addEventListener('click', ()=>{
  if(removendoUsuarioEmpresa) return;
  vinculoIdParaRemover = null;
  closeModal('overlayRemoverUsuario');
});

function mostrarErroRemoverUsuario(erro){
  const el = document.getElementById('removerUsuarioError');
  const codigo = erro && erro.code;
  const mensagens = {
    TRQ44: 'Não foi possível identificar o vínculo a remover.',
    TRQ45: 'Você não tem permissão para remover esse acesso.',
    TRQ46: 'Este vínculo já está inativo.',
    TRQ47: 'Vínculo não encontrado. Atualize a lista e tente novamente.',
    TRQ49: 'Não é possível remover o único proprietário ativo da empresa.',
    ESTADO_DESATUALIZADO: 'Este vínculo não está mais disponível para remoção. Atualize a lista e tente novamente.'
  };
  el.textContent = mensagens[codigo] || 'Não foi possível remover o acesso agora. Tente novamente.';
  el.classList.remove('hidden');
}

document.getElementById('removerUsuarioConfirmarBtn').addEventListener('click', async ()=>{
  if(removendoUsuarioEmpresa || !vinculoIdParaRemover) return;

  // Revalidação defensiva imediatamente antes de chamar a RPC — o estado
  // pode ter mudado entre a abertura do modal e este clique.
  if(!validarRemocaoUsuarioEmpresa(vinculoIdParaRemover)){
    mostrarErroRemoverUsuario({ code: 'ESTADO_DESATUALIZADO' });
    return;
  }

  const confirmarBtn = document.getElementById('removerUsuarioConfirmarBtn');
  const cancelarBtn = document.getElementById('removerUsuarioCancelarBtn');
  removendoUsuarioEmpresa = true;
  confirmarBtn.disabled = true;
  cancelarBtn.disabled = true;

  try{
    const { data: resultadoRpc, error } = await sb.rpc('remover_usuario_empresa', {
      p_vinculo_id: vinculoIdParaRemover
    });

    if(error){
      mostrarErroRemoverUsuario(error);
      return;
    }

    const resultado = Array.isArray(resultadoRpc) ? resultadoRpc[0] : resultadoRpc;
    if(!resultado || !resultado.vinculo_id){
      mostrarErroRemoverUsuario({ code: null });
      return;
    }

    closeModal('overlayRemoverUsuario');
    vinculoIdParaRemover = null;

    // Mesmo padrão de invalidação + recarga usado em "Adicionar usuário".
    // Como o filtro padrão é "Ativos", o vínculo agora inativo some da
    // visualização atual — continua acessível em "Inativos"/"Todos".
    usuariosEmpresaCarregados = false;
    await carregarUsuariosEmpresa();

    mostrarFeedbackUsuariosEmpresa('Acesso removido com sucesso.');
  } catch(erroInesperado){
    mostrarErroRemoverUsuario({ code: null });
  } finally {
    removendoUsuarioEmpresa = false;
    confirmarBtn.disabled = false;
    cancelarBtn.disabled = false;
  }
});

function abrirModalNovaEmpresa(){
  // Guarda defensiva de frontend: a segurança real fica na RPC (TRQ15),
  // isto só evita abrir o modal por uma chamada acidental quando o botão
  // que o dispara já deveria estar oculto para o papel atual.
  if(!contextoEmpresa || contextoEmpresa.papel !== 'proprietario') return;
  document.getElementById('novaEmpresaNome').value = '';
  document.getElementById('novaEmpresaCnpj').value = '';
  document.getElementById('novaEmpresaTelefone').value = '';
  document.getElementById('novaEmpresaError').classList.add('hidden');
  document.getElementById('novaEmpresaSubmitBtn').disabled = false;
  document.getElementById('novaEmpresaCancelarBtn').disabled = false;
  // Novo id só quando o modal é aberto do zero — reaproveitado em retries
  // do mesmo envio (erro/timeout), nunca entre duas empresas diferentes.
  novaEmpresaId = crypto.randomUUID();
  openModal('overlayNovaEmpresa');
}
document.getElementById('novaEmpresaConfigBtn').addEventListener('click', abrirModalNovaEmpresa);
document.getElementById('novaEmpresaCancelarBtn').addEventListener('click', ()=>closeModal('overlayNovaEmpresa'));

function mostrarErroNovaEmpresa(erro){
  const el = document.getElementById('novaEmpresaError');
  const codigo = erro && erro.code;
  const mensagens = {
    TRQ11: 'Sua sessão não é válida. Atualize a página e tente novamente.',
    TRQ14: 'Informe o nome da empresa.',
    TRQ15: 'Somente o proprietário pode criar uma nova empresa.',
    TRQ16: 'Não foi possível criar a empresa agora. Tente novamente.'
  };
  el.textContent = mensagens[codigo] || 'Não foi possível criar a empresa agora. Tente novamente.';
  el.classList.remove('hidden');
}

document.getElementById('novaEmpresaSubmitBtn').addEventListener('click', async ()=>{
  const nome = document.getElementById('novaEmpresaNome').value.trim();
  const cnpj = document.getElementById('novaEmpresaCnpj').value.trim();
  const telefone = document.getElementById('novaEmpresaTelefone').value.trim();
  const errEl = document.getElementById('novaEmpresaError');
  errEl.classList.add('hidden');

  if(!nome){ mostrarErroNovaEmpresa({ code: 'TRQ14' }); return; }

  const submitBtn = document.getElementById('novaEmpresaSubmitBtn');
  const cancelBtn = document.getElementById('novaEmpresaCancelarBtn');
  // Capturado antes do await: imune a uma eventual reabertura do modal
  // (que geraria um novaEmpresaId novo) enquanto esta chamada ainda está
  // em voo. Cancelar fica bloqueado logo abaixo justamente para essa
  // reabertura não poder acontecer, mas a captura local é a garantia
  // definitiva, independente disso.
  const empresaIdSolicitada = novaEmpresaId;

  submitBtn.disabled = true;
  cancelBtn.disabled = true;

  try{
    const { data: resultadoRpc, error } = await sb.rpc('criar_nova_empresa_com_vinculo', {
      p_empresa_id: empresaIdSolicitada,
      p_nome_empresa: nome,
      p_cnpj_empresa: cnpj || null,
      p_telefone_empresa: telefone || null,
      p_empresa_origem_id: empresaId
    });

    if(error){
      mostrarErroNovaEmpresa(error);
      return;
    }

    const resultado = Array.isArray(resultadoRpc) ? resultadoRpc[0] : resultadoRpc;
    if(!resultado || !resultado.empresa_id){
      mostrarErroNovaEmpresa({ code: null });
      return;
    }

    persistirEscolhaERecarregar(usuarioIdAtual, resultado.empresa_id);
  } catch(erroInesperado){
    // Falha fora do contrato normal da RPC (erro de rede, exceção do
    // próprio SDK, etc.) — mesma mensagem genérica de erro técnico,
    // nunca uma tela em branco silenciosa.
    mostrarErroNovaEmpresa({ code: null });
  } finally {
    submitBtn.disabled = false;
    cancelBtn.disabled = false;
  }
});

checkSessaoExistente();
