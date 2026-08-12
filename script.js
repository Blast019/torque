const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const DIAS_AGUARDANDO_RETORNO = 5;
const LIMITE_AVISOS = 3;

let empresaId = null;
let data = { clientes: [], veiculos: [], pecas: [], agendamentos: [], fornecedores: [] };
let modoCadastro = false;
let filtroClientes = '';
let filtroVeiculos = '';
let filtroAgendamentos = '';
let filtroPecas = '';
let filtroFornecedores = '';

// ---------------- AUTH ----------------
document.getElementById('authToggleLink').addEventListener('click', ()=>{
  modoCadastro = !modoCadastro;
  document.getElementById('authTitle').textContent = modoCadastro ? 'Criar conta' : 'Entrar';
  document.getElementById('authSub').textContent = modoCadastro ? 'Cadastre sua oficina no Torque' : 'Acesse o painel da sua oficina';
  document.getElementById('authNomeField').classList.toggle('hidden', !modoCadastro);
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
  const errEl = document.getElementById('authError');
  errEl.classList.add('hidden');

  if(!email || !password){ showAuthError('Preencha e-mail e senha.'); return; }

  if(modoCadastro){
    const { data: signData, error } = await sb.auth.signUp({ email, password });
    if(error){ showAuthError(error.message); return; }
    // cria a empresa vinculada ao novo usuário
    if(signData.user){
      await sb.from('empresas').insert({ owner_id: signData.user.id, nome: nomeOficina || 'Minha oficina' });
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

  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.remove('hidden');

  await carregarDados();
}

// ---------------- DADOS ----------------
async function carregarDados(){
  document.getElementById('loadingState').classList.remove('hidden');
  document.getElementById('appContent').classList.add('hidden');

  const [{ data: clientes }, { data: veiculos }, { data: pecas }, { data: agendamentos }, { data: fornecedores }] = await Promise.all([
    sb.from('clientes').select('*').eq('empresa_id', empresaId).order('nome'),
    sb.from('veiculos').select('*').eq('empresa_id', empresaId),
    sb.from('pecas').select('*').eq('empresa_id', empresaId).order('nome'),
    sb.from('agendamentos').select('*').eq('empresa_id', empresaId).order('data_agendamento'),
    sb.from('fornecedores').select('*').eq('empresa_id', empresaId).order('nome'),
  ]);
  data.clientes = clientes || [];
  data.veiculos = veiculos || [];
  data.pecas = pecas || [];
  data.agendamentos = agendamentos || [];
  data.fornecedores = fornecedores || [];

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
document.getElementById('buscaVeiculos').addEventListener('input', (e)=>{ filtroVeiculos = e.target.value.trim().toLowerCase(); renderVeiculos(); });
document.getElementById('buscaAgendamentos').addEventListener('input', (e)=>{ filtroAgendamentos = e.target.value.trim().toLowerCase(); renderAgendamentos(); });
document.getElementById('buscaPecas').addEventListener('input', (e)=>{ filtroPecas = e.target.value.trim().toLowerCase(); renderPecas(); });
document.getElementById('buscaFornecedores').addEventListener('input', (e)=>{ filtroFornecedores = e.target.value.trim().toLowerCase(); renderFornecedores(); });

// ---------------- CLIENTES ----------------
document.getElementById('btnNovoCliente').addEventListener('click', ()=>{
  document.getElementById('modalClienteTitle').textContent = 'Novo cliente';
  document.getElementById('clienteId').value = '';
  document.getElementById('clienteNome').value = '';
  document.getElementById('clienteTelefone').value = '';
  openModal('overlayCliente');
});

function editCliente(id){
  const c = data.clientes.find(x=>x.id===id);
  if(!c) return;
  document.getElementById('modalClienteTitle').textContent = 'Editar cliente';
  document.getElementById('clienteId').value = c.id;
  document.getElementById('clienteNome').value = c.nome;
  document.getElementById('clienteTelefone').value = c.telefone || '';
  openModal('overlayCliente');
}

document.getElementById('salvarClienteBtn').addEventListener('click', async ()=>{
  const id = document.getElementById('clienteId').value;
  const nome = document.getElementById('clienteNome').value.trim();
  const telefone = document.getElementById('clienteTelefone').value.trim();
  if(!nome){ alert('Informe o nome do cliente.'); return; }
  if(id){
    await sb.from('clientes').update({ nome, telefone }).eq('id', id);
  } else {
    await sb.from('clientes').insert({ empresa_id: empresaId, nome, telefone });
  }
  closeModal('overlayCliente');
  await carregarDados();
});

async function excluirCliente(id){
  if(!confirm('Excluir este cliente?')) return;
  await sb.from('clientes').delete().eq('id', id);
  await carregarDados();
}

// ---------------- VEICULOS ----------------
document.getElementById('btnNovoVeiculo').addEventListener('click', ()=>{
  if(data.clientes.length===0){ alert('Cadastre um cliente antes de adicionar um veículo.'); return; }
  document.getElementById('modalVeiculoTitle').textContent = 'Novo veículo';
  document.getElementById('veiculoId').value = '';
  document.getElementById('veiculoPlaca').value = '';
  document.getElementById('veiculoModelo').value = '';
  document.getElementById('veiculoProximaRevisao').value = '';
  populateClienteSelect();
  openModal('overlayVeiculo');
});

function populateClienteSelect(selectedId){
  const sel = document.getElementById('veiculoCliente');
  sel.innerHTML = data.clientes.map(c=>`<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('');
  if(selectedId) sel.value = selectedId;
}

function editVeiculo(id){
  const v = data.veiculos.find(x=>x.id===id);
  if(!v) return;
  document.getElementById('modalVeiculoTitle').textContent = 'Editar veículo';
  document.getElementById('veiculoId').value = v.id;
  document.getElementById('veiculoPlaca').value = v.placa;
  document.getElementById('veiculoModelo').value = v.modelo;
  document.getElementById('veiculoProximaRevisao').value = v.proxima_revisao || '';
  populateClienteSelect(v.cliente_id);
  openModal('overlayVeiculo');
}

document.getElementById('salvarVeiculoBtn').addEventListener('click', async ()=>{
  const id = document.getElementById('veiculoId').value;
  const cliente_id = document.getElementById('veiculoCliente').value;
  const placa = document.getElementById('veiculoPlaca').value.trim().toUpperCase();
  const modelo = document.getElementById('veiculoModelo').value.trim();
  const proxima_revisao = document.getElementById('veiculoProximaRevisao').value || null;
  if(!placa || !modelo){ alert('Informe placa e modelo.'); return; }
  if(id){
    await sb.from('veiculos').update({ cliente_id, placa, modelo, proxima_revisao }).eq('id', id);
  } else {
    await sb.from('veiculos').insert({ empresa_id: empresaId, cliente_id, placa, modelo, proxima_revisao });
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
  const hoje = new Date().toISOString().slice(0,10);
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
    return c.nome.toLowerCase().includes(termo) || (c.telefone||'').toLowerCase().includes(termo) || placas.includes(termo);
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
  const body = document.getElementById('agendamentosBody');
  const termo = filtroAgendamentos;
  let lista = [...data.agendamentos].sort((a,b)=>(a.data_agendamento||'').localeCompare(b.data_agendamento||''));
  if(termo){
    lista = lista.filter(a=>{
      const cliente = data.clientes.find(c=>c.id===a.cliente_id);
      const veiculo = data.veiculos.find(v=>v.id===a.veiculo_id);
      return (cliente ? cliente.nome.toLowerCase().includes(termo) : false)
        || (veiculo ? (veiculo.placa||'').toLowerCase().includes(termo) || (veiculo.modelo||'').toLowerCase().includes(termo) : false)
        || (a.observacao||'').toLowerCase().includes(termo);
    });
  }
  if(lista.length===0){ body.innerHTML = `<tr><td colspan="6" class="empty-note">${termo ? 'Nenhum agendamento encontrado.' : 'Nenhum agendamento cadastrado ainda.'}</td></tr>`; return; }
  body.innerHTML = lista.map(a=>{
    const cliente = data.clientes.find(c=>c.id===a.cliente_id);
    const veiculo = data.veiculos.find(v=>v.id===a.veiculo_id);
    let dataLabel = '—';
    if(a.data_agendamento){
      dataLabel = new Date(a.data_agendamento+'T00:00:00').toLocaleDateString('pt-BR');
      if(a.horario) dataLabel += ` às ${a.horario.slice(0,5)}`;
    }
    const concluido = a.status === 'concluido';
    return `<tr>
      <td>${cliente ? escapeHtml(cliente.nome) : '—'}</td>
      <td>${veiculo ? escapeHtml(veiculo.placa)+' — '+escapeHtml(veiculo.modelo) : '<span class="tag-pill">sem veículo</span>'}</td>
      <td>${dataLabel}</td>
      <td>${escapeHtml(a.observacao || '—')}</td>
      <td><span class="tag-pill">${concluido ? 'Concluído' : 'Agendado'}</span></td>
      <td><div class="row-actions">
        ${concluido ? '' : `<button class="btn btn-ghost btn-sm" onclick="marcarAgendamentoConcluido('${a.id}')">Concluir</button>`}
        <button class="btn btn-ghost btn-sm" onclick="editAgendamento('${a.id}')">Editar</button>
        <button class="btn btn-ghost btn-sm" onclick="excluirAgendamento('${a.id}')">Excluir</button>
      </div></td></tr>`;
  }).join('');
}

// ---------------- PECAS ----------------
document.getElementById('btnNovaPeca').addEventListener('click', ()=>{
  document.getElementById('modalPecaTitle').textContent = 'Nova peça';
  document.getElementById('pecaId').value = '';
  document.getElementById('pecaNome').value = '';
  document.getElementById('pecaQtd').value = '';
  document.getElementById('pecaMin').value = '';
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
  document.getElementById('pecaPreco').value = p.preco;
  populateFornecedorSelect(p.fornecedor_id);
  openModal('overlayPeca');
}

document.getElementById('salvarPecaBtn').addEventListener('click', async ()=>{
  const id = document.getElementById('pecaId').value;
  const nome = document.getElementById('pecaNome').value.trim();
  const qtd = parseInt(document.getElementById('pecaQtd').value) || 0;
  const estoque_minimo = parseInt(document.getElementById('pecaMin').value) || 0;
  const preco = parseFloat(document.getElementById('pecaPreco').value) || 0;
  const fornecedor_id = document.getElementById('pecaFornecedor').value || null;
  if(!nome){ alert('Informe o nome da peça.'); return; }
  if(id){
    await sb.from('pecas').update({ nome, qtd, estoque_minimo, preco, fornecedor_id }).eq('id', id);
  } else {
    await sb.from('pecas').insert({ empresa_id: empresaId, nome, qtd, estoque_minimo, preco, fornecedor_id });
  }
  closeModal('overlayPeca');
  await carregarDados();
});

async function excluirPeca(id){
  if(!confirm('Excluir esta peça do estoque?')) return;
  await sb.from('pecas').delete().eq('id', id);
  await carregarDados();
}

// ---------------- FORNECEDORES ----------------
document.getElementById('btnNovoFornecedor').addEventListener('click', ()=>{
  document.getElementById('modalFornecedorTitle').textContent = 'Novo fornecedor';
  document.getElementById('fornecedorId').value = '';
  document.getElementById('fornecedorNome').value = '';
  document.getElementById('fornecedorTelefone').value = '';
  openModal('overlayFornecedor');
});

function editFornecedor(id){
  const f = data.fornecedores.find(x=>x.id===id);
  if(!f) return;
  document.getElementById('modalFornecedorTitle').textContent = 'Editar fornecedor';
  document.getElementById('fornecedorId').value = f.id;
  document.getElementById('fornecedorNome').value = f.nome;
  document.getElementById('fornecedorTelefone').value = f.telefone || '';
  openModal('overlayFornecedor');
}

document.getElementById('salvarFornecedorBtn').addEventListener('click', async ()=>{
  const id = document.getElementById('fornecedorId').value;
  const nome = document.getElementById('fornecedorNome').value.trim();
  const telefone = document.getElementById('fornecedorTelefone').value.trim();
  if(!nome){ alert('Informe o nome do fornecedor.'); return; }
  if(id){
    await sb.from('fornecedores').update({ nome, telefone }).eq('id', id);
  } else {
    await sb.from('fornecedores').insert({ empresa_id: empresaId, nome, telefone });
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
  if(lista.length===0){ body.innerHTML = `<tr><td colspan="4" class="empty-note">${termo ? 'Nenhum fornecedor encontrado.' : 'Nenhum fornecedor cadastrado ainda.'}</td></tr>`; return; }
  body.innerHTML = lista.map(f=>{
    const nPecas = data.pecas.filter(p=>p.fornecedor_id===f.id).length;
    return `<tr><td>${escapeHtml(f.nome)}</td><td class="mono">${escapeHtml(f.telefone||'—')}</td>
      <td><span class="tag-pill">${nPecas} peça${nPecas===1?'':'s'}</span></td>
      <td><div class="row-actions"><button class="btn btn-ghost btn-sm" onclick="editFornecedor('${f.id}')">Editar</button><button class="btn btn-ghost btn-sm" onclick="excluirFornecedor('${f.id}')">Excluir</button></div></td></tr>`;
  }).join('');
}

// ---------------- HELPERS ----------------
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function diasAte(dataStr){ if(!dataStr) return null; const hoje = new Date(); hoje.setHours(0,0,0,0); const alvo = new Date(dataStr+'T00:00:00'); return Math.round((alvo - hoje) / 86400000); }
function waLink(telefone, mensagem){ const digits = (telefone||'').replace(/\D/g,''); const withCountry = digits.startsWith('55') ? digits : '55'+digits; return `https://wa.me/${withCountry}?text=${encodeURIComponent(mensagem)}`; }

// ---------------- RENDER ----------------
function renderAll(){ renderPainel(); renderAgendamentos(); renderClientes(); renderVeiculos(); renderPecas(); renderFornecedores(); }

function tagCardHtml(v, cliente, dias, opts){
  const overdue = dias < 0;
  const statusLabel = overdue ? `${Math.abs(dias)} dia${Math.abs(dias)===1?'':'s'} vencida` : (dias===0 ? 'Vence hoje' : `Vence em ${dias} dia${dias===1?'':'s'}`);
  const nomeCliente = cliente ? cliente.nome : 'Cliente não vinculado';
  const telefone = cliente ? cliente.telefone : '';
  const avisos = v.contatos_count || 0;
  const msg = `Olá, ${nomeCliente.split(' ')[0]}! Aqui é da oficina. A revisão do seu ${v.modelo} (placa ${v.placa}) está ${overdue ? 'vencida' : 'próxima do vencimento'}. Podemos agendar um horário para você?`;
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
  document.getElementById('statVeiculos').textContent = data.veiculos.length;

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
  const body = document.getElementById('clientesBody');
  const termo = filtroClientes;
  const lista = termo ? data.clientes.filter(c=>c.nome.toLowerCase().includes(termo) || (c.telefone||'').toLowerCase().includes(termo)) : data.clientes;
  if(lista.length===0){ body.innerHTML = `<tr><td colspan="4" class="empty-note">${termo ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.'}</td></tr>`; return; }
  body.innerHTML = lista.map(c=>{
    const nVeiculos = data.veiculos.filter(v=>v.cliente_id===c.id).length;
    return `<tr><td>${escapeHtml(c.nome)}</td><td class="mono">${escapeHtml(c.telefone||'—')}</td>
      <td><span class="tag-pill">${nVeiculos} veículo${nVeiculos===1?'':'s'}</span></td>
      <td><div class="row-actions"><button class="btn btn-ghost btn-sm" onclick="abrirModalAgendamento('${c.id}')">Agendar</button><button class="btn btn-ghost btn-sm" onclick="editCliente('${c.id}')">Editar</button><button class="btn btn-ghost btn-sm" onclick="excluirCliente('${c.id}')">Excluir</button></div></td></tr>`;
  }).join('');
}

function renderVeiculos(){
  const body = document.getElementById('veiculosBody');
  const termo = filtroVeiculos;
  let lista = data.veiculos;
  if(termo){
    lista = lista.filter(v=>{
      const cliente = data.clientes.find(c=>c.id===v.cliente_id);
      return (v.placa||'').toLowerCase().includes(termo) || (v.modelo||'').toLowerCase().includes(termo) || (cliente ? cliente.nome.toLowerCase().includes(termo) : false);
    });
  }
  if(lista.length===0){ body.innerHTML = `<tr><td colspan="5" class="empty-note">${termo ? 'Nenhum veículo encontrado.' : 'Nenhum veículo cadastrado ainda.'}</td></tr>`; return; }
  body.innerHTML = lista.map(v=>{
    const cliente = data.clientes.find(c=>c.id===v.cliente_id);
    const dias = diasAte(v.proxima_revisao);
    let revisaoLabel = '—';
    if(v.proxima_revisao){
      const d = new Date(v.proxima_revisao+'T00:00:00');
      revisaoLabel = d.toLocaleDateString('pt-BR');
      if(dias<0) revisaoLabel += ` (vencida)`;
    }
    const btnAgendar = cliente ? `<button class="btn btn-ghost btn-sm" onclick="abrirModalAgendamento('${v.cliente_id}','${v.id}')">Agendar</button>` : '';
    return `<tr><td class="mono">${escapeHtml(v.placa)}</td><td>${escapeHtml(v.modelo)}</td>
      <td>${cliente ? escapeHtml(cliente.nome) : '<span class="tag-pill">sem cliente</span>'}</td><td>${revisaoLabel}</td>
      <td><div class="row-actions">${btnAgendar}<button class="btn btn-ghost btn-sm" onclick="editVeiculo('${v.id}')">Editar</button><button class="btn btn-ghost btn-sm" onclick="excluirVeiculo('${v.id}')">Excluir</button></div></td></tr>`;
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
      <td><div class="row-actions"><button class="btn btn-ghost btn-sm" onclick="editPeca('${p.id}')">Editar</button><button class="btn btn-ghost btn-sm" onclick="excluirPeca('${p.id}')">Excluir</button></div></td></tr>`;
  }).join('');
}

checkSessaoExistente();
