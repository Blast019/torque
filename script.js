const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const DIAS_AGUARDANDO_RETORNO = 5;
const LIMITE_AVISOS = 3;

let empresaId = null;
let empresaNome = 'a oficina';
let data = { clientes: [], veiculos: [], pecas: [], agendamentos: [], fornecedores: [], os: [], osItens: [], movimentos: [], marcas: [], modelos: [], funcionarios: [] };
let filtroFuncionarios = '';
let modoCadastro = false;
let filtroClientes = '';
let filtroStatusCliente = '';
let filtroAgendamentos = '';
let filtroStatusAgendamento = '';
let filtroDataAgendamento = '';
let filtroPecas = '';
let filtroFornecedores = '';
let filtroOS = '';
let filtroPagoOS = '';
let filtroDataOS = '';
let colunasExpandidas = {};
let osItensAtual = [];
let financeiroCursor = new Date();
let filtroTipoMovimento = '';
let filtroCategoriaMovimento = '';

// ---------------- AUTH ----------------
document.getElementById('authToggleLink').addEventListener('click', ()=>{
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
  const link2 = document.getElementById('authToggleLink2');
  if(link2) link2.addEventListener('click', ()=>document.getElementById('authToggleLink').click());
});

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
    const { data: signData, error } = await sb.auth.signUp({ email, password });
    if(error){ showAuthError(error.message); return; }
    // cria a empresa vinculada ao novo usuário
    if(signData.user){
      await sb.from('empresas').insert({ owner_id: signData.user.id, nome: nomeOficina || 'Minha oficina', cnpj: cnpjOficina, telefone: telefoneOficina });
    }
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

document.getElementById('logoutBtn').addEventListener('click', async ()=>{
  await sb.auth.signOut();
  location.reload();
});

async function checkSessaoExistente(){
  const { data: { session } } = await sb.auth.getSession();
  if(session) await iniciarApp();
}

async function iniciarApp(){
  const { data: { user } } = await sb.auth.getUser();
  if(!user) return;

  let { data: empresas } = await sb.from('empresas').select('*').eq('owner_id', user.id).limit(1);
  if(!empresas || empresas.length===0){
    const { data: novaEmpresa } = await sb.from('empresas').insert({ owner_id: user.id, nome: 'Minha oficina' }).select();
    empresas = novaEmpresa;
  }
  const empresa = empresas[0];
  empresaId = empresa.id;
  document.getElementById('empresaNomeLabel').textContent = empresa.nome;
  empresaNome = empresa.nome || 'a oficina';
  document.getElementById('oficinaNome').value = empresa.nome || '';
  document.getElementById('oficinaCnpj').value = empresa.cnpj || '';
  document.getElementById('oficinaTelefone').value = empresa.telefone || '';
  document.getElementById('oficinaPlanoLabel').textContent = empresa.plano || 'Teste';
  const statusPlano = empresa.status_assinatura || 'ativo';
  const statusLabels = { ativo: 'Ativo', inadimplente: 'Inadimplente', cancelado: 'Cancelado' };
  document.getElementById('oficinaStatusLabel').innerHTML = `<span class="tag-pill">${statusLabels[statusPlano] || statusPlano}</span>`;

  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.remove('hidden');

  await carregarMarcasModelos();
  await carregarDados();
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

  const [{ data: clientes }, { data: veiculos }, { data: pecas }, { data: agendamentos }, { data: fornecedores }, { data: os }, { data: osItens }, { data: movimentos }, { data: funcionarios }] = await Promise.all([
    sb.from('clientes').select('*').eq('empresa_id', empresaId).order('nome'),
    sb.from('veiculos').select('*').eq('empresa_id', empresaId),
    sb.from('pecas').select('*').eq('empresa_id', empresaId).order('nome'),
    sb.from('agendamentos').select('*').eq('empresa_id', empresaId).order('data_agendamento'),
    sb.from('fornecedores').select('*').eq('empresa_id', empresaId).order('nome'),
    sb.from('ordens_servico').select('*').eq('empresa_id', empresaId).order('data', { ascending: false }),
    sb.from('os_itens').select('*'),
    sb.from('movimentos_caixa').select('*').eq('empresa_id', empresaId).order('data', { ascending: false }),
    sb.from('funcionarios').select('*').eq('empresa_id', empresaId).order('nome'),
  ]);
  data.clientes = clientes || [];
  data.veiculos = veiculos || [];
  data.pecas = pecas || [];
  data.agendamentos = agendamentos || [];
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
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.add('hidden'));
    document.getElementById('tab-'+btn.dataset.tab).classList.remove('hidden');
  });
});

function closeModal(id){ document.getElementById(id).classList.remove('show'); }
function openModal(id){ document.getElementById(id).classList.add('show'); }

document.getElementById('buscaClientes').addEventListener('input', (e)=>{ filtroClientes = e.target.value.trim().toLowerCase(); renderClientes(); });
document.getElementById('filtroStatusClienteSelect').addEventListener('change', (e)=>{ filtroStatusCliente = e.target.value; renderClientes(); });
document.getElementById('buscaAgendamentos').addEventListener('input', (e)=>{ filtroAgendamentos = e.target.value.trim().toLowerCase(); renderAgendamentos(); });
document.getElementById('filtroStatusAgendamentoSelect').addEventListener('change', (e)=>{ filtroStatusAgendamento = e.target.value; renderAgendamentos(); });
document.getElementById('filtroDataAgendamentoInput').addEventListener('change', (e)=>{ filtroDataAgendamento = e.target.value; renderAgendamentos(); });
document.getElementById('btnLimparFiltroDataAgendamento').addEventListener('click', ()=>{ filtroDataAgendamento=''; document.getElementById('filtroDataAgendamentoInput').value=''; renderAgendamentos(); });
document.getElementById('buscaPecas').addEventListener('input', (e)=>{ filtroPecas = e.target.value.trim().toLowerCase(); renderPecas(); });
document.getElementById('buscaFornecedores').addEventListener('input', (e)=>{ filtroFornecedores = e.target.value.trim().toLowerCase(); renderFornecedores(); });
document.getElementById('buscaOS').addEventListener('input', (e)=>{ filtroOS = e.target.value.trim().toLowerCase(); renderOS(); });
document.getElementById('filtroPagoOSSelect').addEventListener('change', (e)=>{ filtroPagoOS = e.target.value; renderOS(); });
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
  openModal('overlayCliente');
});

function editCliente(id){
  const c = data.clientes.find(x=>x.id===id);
  if(!c) return;
  document.getElementById('modalClienteTitle').textContent = 'Editar cliente';
  document.getElementById('clienteId').value = c.id;
  document.getElementById('clienteNome').value = c.nome;
  document.getElementById('clienteCpf').value = c.cpf || '';
  document.getElementById('clienteTelefone').value = c.telefone || '';
  document.getElementById('clienteEmail').value = c.email || '';
  openModal('overlayCliente');
}

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
    const { error } = await sb.from('clientes').insert({ empresa_id: empresaId, nome, cpf, telefone, email });
    if(error){ alert('Erro ao salvar cliente: ' + error.message); return; }
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

// ---------------- AGENDAMENTOS ----------------
document.getElementById('btnNovoAgendamento').addEventListener('click', ()=>{
  abrirModalAgendamento();
});

function abrirModalAgendamento(clienteId, veiculoId){
  document.getElementById('modalAgendamentoTitle').textContent = 'Novo agendamento';
  document.getElementById('agendamentoId').value = '';
  document.getElementById('agendamentoData').value = '';
  document.getElementById('agendamentoHorario').value = '';
  document.getElementById('agendamentoObservacao').value = '';
  document.getElementById('agendamentoSugestoes').classList.add('hidden');
  if(clienteId){
    selecionarClienteAgendamento(clienteId);
    if(veiculoId) document.getElementById('agendamentoVeiculo').value = veiculoId;
  } else {
    document.getElementById('agendamentoBuscaCliente').value = '';
    document.getElementById('agendamentoClienteId').value = '';
    document.getElementById('agendamentoVeiculo').innerHTML = '<option value="">Busque um cliente primeiro</option>';
  }
  openModal('overlayAgendamento');
}

document.getElementById('agendamentoBuscaCliente').addEventListener('input', (e)=>{
  const termo = e.target.value.trim().toLowerCase();
  document.getElementById('agendamentoClienteId').value = '';
  document.getElementById('agendamentoVeiculo').innerHTML = '<option value="">Busque um cliente primeiro</option>';
  const sugestoesEl = document.getElementById('agendamentoSugestoes');
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
    return `<div class="autocomplete-item" onclick="selecionarClienteAgendamento('${c.id}')">
      <div class="ac-nome">${escapeHtml(c.nome)}</div>
      <div class="ac-sub">${escapeHtml(c.telefone||'sem telefone')} · ${nVeiculos} veículo${nVeiculos===1?'':'s'}</div>
    </div>`;
  }).join('');
  sugestoesEl.classList.remove('hidden');
});

function selecionarClienteAgendamento(clienteId){
  const c = data.clientes.find(x=>x.id===clienteId);
  if(!c) return;
  document.getElementById('agendamentoClienteId').value = c.id;
  document.getElementById('agendamentoBuscaCliente').value = c.nome;
  document.getElementById('agendamentoSugestoes').classList.add('hidden');
  const veiculosCliente = data.veiculos.filter(v=>v.cliente_id===c.id);
  const sel = document.getElementById('agendamentoVeiculo');
  sel.innerHTML = veiculosCliente.length===0
    ? '<option value="">Cliente sem veículo cadastrado</option>'
    : veiculosCliente.map(v=>`<option value="${v.id}">${escapeHtml(v.placa)} — ${escapeHtml(v.modelo)}</option>`).join('');
}

document.addEventListener('click', (e)=>{
  const campo = document.getElementById('agendamentoBuscaCliente');
  const sugestoes = document.getElementById('agendamentoSugestoes');
  if(campo && sugestoes && !campo.contains(e.target) && !sugestoes.contains(e.target)){
    sugestoes.classList.add('hidden');
  }
});

function editAgendamento(id){
  const a = data.agendamentos.find(x=>x.id===id);
  if(!a) return;
  document.getElementById('modalAgendamentoTitle').textContent = 'Editar agendamento';
  document.getElementById('agendamentoId').value = a.id;
  document.getElementById('agendamentoData').value = a.data_agendamento || '';
  document.getElementById('agendamentoHorario').value = a.horario || '';
  document.getElementById('agendamentoObservacao').value = a.observacao || '';
  selecionarClienteAgendamento(a.cliente_id);
  if(a.veiculo_id) document.getElementById('agendamentoVeiculo').value = a.veiculo_id;
  openModal('overlayAgendamento');
}

document.getElementById('salvarAgendamentoBtn').addEventListener('click', async ()=>{
  const id = document.getElementById('agendamentoId').value;
  const cliente_id = document.getElementById('agendamentoClienteId').value;
  const veiculo_id = document.getElementById('agendamentoVeiculo').value || null;
  const data_agendamento = document.getElementById('agendamentoData').value;
  const horario = document.getElementById('agendamentoHorario').value || null;
  const observacao = document.getElementById('agendamentoObservacao').value.trim();
  if(!cliente_id){ alert('Busque e selecione um cliente.'); return; }
  if(!data_agendamento){ alert('Informe a data do agendamento.'); return; }
  if(id){
    await sb.from('agendamentos').update({ cliente_id, veiculo_id, data_agendamento, horario, observacao }).eq('id', id);
  } else {
    await sb.from('agendamentos').insert({ empresa_id: empresaId, cliente_id, veiculo_id, data_agendamento, horario, observacao, status: 'agendado' });
  }
  closeModal('overlayAgendamento');
  await carregarDados();
});

async function marcarAgendamentoConcluido(id){
  await sb.from('agendamentos').update({ status: 'concluido' }).eq('id', id);
  await carregarDados();
}

async function excluirAgendamento(id){
  if(!confirm('Excluir este agendamento?')) return;
  await sb.from('agendamentos').delete().eq('id', id);
  await carregarDados();
}

function renderAgendamentos(){
  const wrap = document.getElementById('agendamentosLista');
  const termo = filtroAgendamentos;
  let lista = [...data.agendamentos].sort((a,b)=>(a.data_agendamento||'').localeCompare(b.data_agendamento||''));
  if(filtroStatusAgendamento){
    lista = lista.filter(a=>a.status === filtroStatusAgendamento);
  }
  if(filtroDataAgendamento){
    lista = lista.filter(a=>a.data_agendamento === filtroDataAgendamento);
  }
  if(termo){
    lista = lista.filter(a=>{
      const cliente = data.clientes.find(c=>c.id===a.cliente_id);
      const veiculo = data.veiculos.find(v=>v.id===a.veiculo_id);
      return (cliente ? cliente.nome.toLowerCase().includes(termo) : false)
        || (veiculo ? (veiculo.placa||'').toLowerCase().includes(termo) || (veiculo.modelo||'').toLowerCase().includes(termo) : false)
        || (a.observacao||'').toLowerCase().includes(termo);
    });
  }
  if(lista.length===0){
    wrap.innerHTML = `<div class="empty-note">${termo || filtroStatusAgendamento || filtroDataAgendamento ? 'Nenhum agendamento encontrado.' : 'Nenhum agendamento cadastrado ainda.'}</div>`;
    return;
  }
  wrap.innerHTML = lista.map(a=>{
    const cliente = data.clientes.find(c=>c.id===a.cliente_id);
    const veiculo = data.veiculos.find(v=>v.id===a.veiculo_id);
    let dataLabel = '—';
    if(a.data_agendamento){
      dataLabel = new Date(a.data_agendamento+'T00:00:00').toLocaleDateString('pt-BR');
      if(a.horario) dataLabel += ` às ${a.horario.slice(0,5)}`;
    }
    const concluido = a.status === 'concluido';
    const infoPartes = [dataLabel, veiculo ? `${veiculo.placa} — ${veiculo.modelo}` : 'sem veículo', a.observacao || null].filter(Boolean);
    return `<div class="cliente-card${concluido ? ' cliente-inativo' : ''}">
      <div class="cliente-card-header">
        <div>
          <div class="cliente-card-nome">${cliente ? escapeHtml(cliente.nome) : 'Cliente não vinculado'} <span class="tag-pill ${concluido ? '' : 'ativo-pill'}">${concluido ? 'Concluído' : 'Agendado'}</span></div>
          <div class="cliente-card-info">${infoPartes.map(escapeHtml).join(' · ')}</div>
        </div>
        <div class="cliente-card-acoes">
          ${concluido ? '' : `<button class="btn btn-sm" onclick="marcarAgendamentoConcluido('${a.id}')">Concluir</button>`}
          <button class="btn btn-ghost btn-sm" onclick="editAgendamento('${a.id}')">Editar</button>
          <button class="btn btn-ghost btn-sm" onclick="excluirAgendamento('${a.id}')">Excluir</button>
        </div>
      </div>
    </div>`;
  }).join('');
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

  wrap.innerHTML = ETAPAS_OS.map(etapa=>{
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
          const descricaoResumo = o.descricao ? (o.descricao.length > 50 ? o.descricao.slice(0,50)+'…' : o.descricao) : '';
          const selectEtapas = o.cancelada
            ? `<select disabled><option>Cancelada</option></select>`
            : `<select onchange="moverStatusOS('${o.id}', this.value)">${ETAPAS_OS.map(e=>`<option value="${e.id}" ${e.id===etapa.id?'selected':''}>${e.label}</option>`).join('')}</select>`;
          const btnBaixa = (!o.cancelada && etapa.id==='entregue' && !o.estoque_baixado) ? `<button class="btn btn-ghost btn-sm" onclick="moverStatusOS('${o.id}','entregue')">Dar baixa no estoque</button>` : '';
          const btnPagar = (!o.cancelada && !o.pago) ? `<button class="btn btn-ghost btn-sm" onclick="marcarOSPaga('${o.id}')">Marcar paga</button>` : '';
          const btnCancelar = !o.cancelada ? `<button class="btn btn-ghost btn-sm" onclick="cancelarOS('${o.id}')">Cancelar OS</button>` : '';
          return `<div class="kanban-card${o.cancelada ? ' kanban-card-cancelada' : ''}">
            <div class="kc-cliente">${cliente ? escapeHtml(cliente.nome) : '—'}${o.cancelada ? ' <span class="tag-pill">Cancelada</span>' : ''}</div>
            <div class="kc-veiculo">${veiculo ? escapeHtml(veiculo.placa)+' — '+escapeHtml(veiculo.modelo) : 'sem veículo'}${descricaoResumo ? ' · '+escapeHtml(descricaoResumo) : ''}${funcionario ? ' · '+escapeHtml(funcionario.nome) : ''}</div>
            <div class="kc-valor">${formatBRL(total)} <span class="tag-pill" style="margin-left:4px;">${o.pago ? 'Pago' : 'Pendente'}</span></div>
            ${selectEtapas}
            <div class="kc-acoes">
              <button class="btn btn-ghost btn-sm" onclick="enviarOSWhatsapp('${o.id}')">WhatsApp</button>
              ${btnPagar}
              ${btnBaixa}
              <button class="btn btn-ghost btn-sm" onclick="editOS('${o.id}')">Editar</button>
              ${btnCancelar}
              <button class="btn btn-ghost btn-sm" onclick="excluirOS('${o.id}')">Excluir</button>
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
function renderAll(){ renderPainel(); renderAgendamentos(); renderClientes(); renderPecas(); renderFornecedores(); renderFuncionarios(); renderOS(); renderFinanceiro(); }

function tagCardHtml(v, cliente, dias, opts){
  const overdue = dias < 0;
  const statusLabel = overdue ? `${Math.abs(dias)} dia${Math.abs(dias)===1?'':'s'} vencida` : (dias===0 ? 'Vence hoje' : `Vence em ${dias} dia${dias===1?'':'s'}`);
  const nomeCliente = cliente ? cliente.nome : 'Cliente não vinculado';
  const telefone = cliente ? cliente.telefone : '';
  const avisos = v.contatos_count || 0;
  const msg = `Olá, ${nomeCliente.split(' ')[0]}! Aqui é da ${empresaNome}. A revisão do seu ${v.modelo} (placa ${v.placa}) está ${overdue ? 'vencida' : 'próxima do vencimento'}. Podemos agendar um horário para você?`;
  const waButton = telefone
    ? `<a class="wa-btn" href="${waLink(telefone, msg)}" target="_blank" rel="noopener" onclick="marcarContatado('${v.id}')">${opts.contatado ? 'Chamar de novo' : 'Chamar no WhatsApp'}</a>`
    : `<span class="tag-pill">sem telefone</span>`;

  if(opts.semRetorno){
    return `<div class="tag-card sem-retorno">
      <div class="tag-left"><div class="plate">${escapeHtml(v.placa||'---')}</div>
        <div class="tag-info"><div class="cliente">${escapeHtml(nomeCliente)}</div><div class="veiculo">${escapeHtml(v.modelo||'')}</div></div></div>
      <div class="tag-right">
        <span class="aviso-count">${avisos}/${LIMITE_AVISOS} avisos enviados</span>
        <button class="btn-link" onclick="marcarRevisaoFeita('${v.id}')">Agendou / revisão feita</button>
        <button class="btn-link" onclick="reabrirFila('${v.id}')">Reabrir na fila</button>
      </div></div>`;
  }

  return `<div class="tag-card ${opts.contatado ? 'contatado' : (overdue?'':'soon')}">
    <div class="tag-left"><div class="plate">${escapeHtml(v.placa||'---')}</div>
      <div class="tag-info"><div class="cliente">${escapeHtml(nomeCliente)}</div><div class="veiculo">${escapeHtml(v.modelo||'')}</div></div></div>
    <div class="tag-right">
      ${avisos > 0 ? `<span class="aviso-count">${avisos}/${LIMITE_AVISOS} avisos</span>` : ''}
      ${opts.contatado ? `<span class="contato-badge">Avisado há ${opts.diasContato} dia${opts.diasContato===1?'':'s'}</span>` : `<span class="tag-status ${overdue?'overdue':'soon'}">${statusLabel}</span>`}
      <button class="btn-link" onclick="marcarRevisaoFeita('${v.id}')">Agendou / revisão feita</button>
      ${waButton}
    </div></div>`;
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
  document.getElementById('statAgendamentosPendentes').textContent = data.agendamentos.filter(a=>a.status==='agendado').length;

  const wrap = document.getElementById('tagsWrap');
  if(linhas.length===0){
    wrap.innerHTML = `<div class="empty-note">Nenhuma revisão vencida ou próxima nos próximos 30 dias.</div>`;
    return;
  }
  let html = '';
  if(fila.length>0){ html += fila.map(({v,cliente,dias})=>tagCardHtml(v,cliente,dias,{contatado:false})).join(''); }
  else if(aguardando.length===0 && semRetorno.length===0){ html += `<div class="empty-note">Nenhum cliente pendente de aviso agora.</div>`; }
  else { html += `<div class="empty-note">Nenhum cliente pendente de aviso agora.</div>`; }
  if(aguardando.length>0){
    html += `<div class="queue-group-label">Aguardando retorno (avisado há menos de ${DIAS_AGUARDANDO_RETORNO} dias)</div>`;
    html += aguardando.map(({v,cliente,dias,diasContato})=>tagCardHtml(v,cliente,dias,{contatado:true,diasContato})).join('');
  }
  if(semRetorno.length>0){
    html += `<div class="queue-group-label">Sem retorno (${LIMITE_AVISOS} avisos enviados, sem resposta)</div>`;
    html += semRetorno.map(({v,cliente,dias})=>tagCardHtml(v,cliente,dias,{semRetorno:true})).join('');
  }
  wrap.innerHTML = html;
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
              <button class="btn btn-ghost btn-sm" onclick="abrirModalAgendamento('${c.id}','${v.id}')">Agendar</button>
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

checkSessaoExistente();
