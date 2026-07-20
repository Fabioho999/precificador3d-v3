import { calculateQuote, calculateDashboardMetrics, formatCurrency, formatLocalDate, toSaoPauloDateKey, validateQuoteItems, PRODUCTION_STATUSES, PAYMENT_STATUSES, COMMERCIAL_STATUSES } from "./domain.js";
import { createRepository, ConflictError } from "./repository.js";
import { createLegacyBackup, migrateLegacyData, hasLegacyData } from "./migration.js";
import { generateOrderPdf } from "./pdf.js";

const SUPABASE_URL = "https://zqblyzxsuuefhpnkibva.supabase.co";
const SUPABASE_KEY = "sb_publishable_mG4lJVyN8EaI_Lc6ehcHGw_8mmssMDT";
const COLLECTIONS = ["settings","filaments","orders","order_items","stock_movements","expenses","recurring_expenses","catalog_products","calibrations","tasks","attachments"];
const DEFAULT_SETTINGS = { studio_name:"Studio FH3D", whatsapp:"", email:"", instagram:"", pix_key:"", pix_holder:"", filament_cost_kg:95, energy_kwh:0.85, k1c_kw:0.25, kobra_kw:0.3, depreciation_hour:2.5, maintenance_hour:0.5, profit_percent:30, packaging_cost:10, modification_terms:"Até 2 rodadas de ajustes no modelo.", validity_terms:"Orçamento válido por 7 dias.", general_notes:"Prazo confirmado após a aprovação." };
const STATUS_LABELS={orcamento:"Orçamento",aprovado:"Aprovado",cancelado:"Cancelado",pendente:"Pendente",em_producao:"Em produção",pronto:"Pronto",enviado:"Enviado",entregue:"Entregue",parcial:"Parcial",pago:"Pago",reembolsado:"Reembolsado"};
const EMPTY_DATA = Object.fromEntries(COLLECTIONS.map(name => [name, []]));

const supabaseClient = window.supabase?.createClient?.(SUPABASE_URL, SUPABASE_KEY, { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } }) || null;
const state = { user:null, data:structuredClone(EMPTY_DATA), settings:{...DEFAULT_SETTINGS}, quote:{ items:[newQuoteItem()], dirty:true, result:null, editingId:null, orderId:null, photos:[], photoIds:[] }, activeTab:"dashboard", busy:false, actionLocks:new Set(), sync:{status:"offline"}, migrationReport:null, unsubscribe:null };
const unavailableRepository=()=>new Proxy({}, {get:(_target,key)=>key==="getStatus"?()=>({status:"offline"}):async()=>{throw new Error("O serviço de nuvem não carregou. Verifique a conexão e tente novamente.");}});
const repo = supabaseClient ? createRepository({ supabaseClient, attachmentBucket:"order-assets", onStatus:setSyncStatus }) : unavailableRepository();

function uid(){ return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function newQuoteItem(seed={}){ return { clientId:uid(), name:"", quantity:1, unitWeightG:"", printHours:"", material:"PLA", filamentId:"", ...seed }; }
function h(value=""){ return String(value ?? "").replace(/[&<>'"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])); }
function byId(id){ return document.getElementById(id); }
function notify(message,type="success"){ const el=byId("notice"); el.textContent=message; el.className=`notice ${type}`; clearTimeout(notify.timer); notify.timer=setTimeout(()=>el.classList.add("hidden"),6500); }
function setSyncStatus(status, detail=""){ const el=byId("syncStatus"); const normalized=typeof status==="object"?status.status:status; const text=typeof status==="object"?(status.message||status.status):detail||status; state.sync={...(typeof status==="object"?status:{}),status:normalized||"offline",message:text}; if(!el)return; el.textContent=({synced:"Sincronizado",pending:"Pendente",offline:"Offline",conflict:"Conflito",error:"Erro"}[normalized]||text||"Offline"); el.className=`sync ${normalized||"offline"}`; el.title=(typeof status==="object"?status.error:detail)||""; }
function setBusy(value){
  state.busy=value;
  if(value) document.querySelectorAll("button:not(:disabled)").forEach(button=>{if(button.dataset.allowBusy!=="true"){button.dataset.busyDisabled="true";button.disabled=true;}});
  else document.querySelectorAll('button[data-busy-disabled="true"]').forEach(button=>{button.disabled=false;delete button.dataset.busyDisabled;});
}
function requireValidForm(id){ const form=byId(id); if(!form?.checkValidity()){ form?.reportValidity(); throw new Error("Revise os campos obrigatórios antes de continuar."); } return form; }

async function compressImage(file,{maxDimension=1600,quality=.82}={}){
  if(!file?.type?.startsWith("image/") || file.type==="image/svg+xml") return file;
  let image;
  try{
    if(globalThis.createImageBitmap) image=await createImageBitmap(file);
    else image=await new Promise((resolve,reject)=>{ const element=new Image(); const url=URL.createObjectURL(file); element.onload=()=>{URL.revokeObjectURL(url);resolve(element);}; element.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("Não foi possível ler a imagem."));}; element.src=url; });
    const width=image.width||image.naturalWidth, height=image.height||image.naturalHeight;
    if(!width||!height || (Math.max(width,height)<=maxDimension && file.size<=1_500_000)) return file;
    const scale=Math.min(1,maxDimension/Math.max(width,height));
    const canvas=document.createElement("canvas"); canvas.width=Math.round(width*scale); canvas.height=Math.round(height*scale);
    canvas.getContext("2d",{alpha:true}).drawImage(image,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/webp",quality));
    if(!blob || blob.size>=file.size) return file;
    const name=String(file.name||"foto").replace(/\.[^.]+$/,".webp");
    return typeof File==="function"?new File([blob],name,{type:blob.type,lastModified:file.lastModified||Date.now()}):Object.assign(blob,{name});
  }catch{ return file; }
  finally{ image?.close?.(); }
}

function settingsRow(){ return state.data.settings?.[0] || state.settings; }
function activeRows(name){ return (state.data[name]||[]).filter(row=>!row.deleted_at && !row.archived_at && row.active!==false); }
function orderItems(orderId){ return activeRows("order_items").filter(item=>item.order_id===orderId); }
function orderAttachments(orderId){ return activeRows("attachments").filter(item=>item.order_id===orderId); }
function filamentMap(){ return new Map(activeRows("filaments").map(f=>[f.id,f])); }
function orderById(id){ return (state.data.orders||[]).find(order=>!order.deleted_at&&order.id===id); }
function decorateOrders(){ return (state.data.orders||[]).filter(order=>!order.deleted_at).map(order=>({...order,items:orderItems(order.id)})); }

async function loadData(){
  if(!state.user){ state.data=structuredClone(EMPTY_DATA); renderAll(); return; }
  setBusy(true);
  try{
    const loaded=await repo.loadAll();
    state.data={...structuredClone(EMPTY_DATA),...loaded};
    state.settings={...DEFAULT_SETTINGS,...(state.data.settings?.[0]||{})};
    await maybeMigrateLegacy();
    renderAll();
    await repo.replayQueue();
    state.unsubscribe?.();
    state.unsubscribe=await repo.subscribe(change=>handleRemoteChange(change));
  }catch(error){ handleError(error,"Não foi possível carregar os dados"); renderAll(); }
  finally{ setBusy(false); }
}

async function maybeMigrateLegacy(){
  const ownerKey="fh3d_v4_legacy_owner",owner=localStorage.getItem(ownerKey);
  if(localStorage.getItem(`fh3d_v4_migrated_${state.user.id}`)) return;
  const mayUseLocal=!owner||owner===state.user.id,hasLocal=mayUseLocal&&hasLegacyData();
  let cloudRows=[];
  try{ cloudRows=await repo.loadLegacyCloud(); }
  catch(error){ if(hasLocal) notify("O backup V3 será migrado quando a nuvem voltar a responder.","error"); return; }
  if(!hasLocal&&!cloudRows.length) return;
  const backup=hasLocal?createLegacyBackup({download:false}):{format:"fh3d-v3-local-storage",version:1,exported_at:new Date().toISOString(),keys:[],data:{},raw:{},parse_errors:[]};
  if(hasLocal&&!owner) localStorage.setItem(ownerKey,state.user.id);
  let result;
  try{ result=await migrateLegacyData({repository:repo,userId:state.user.id,currentData:state.data,backup,cloudRows}); }
  catch(error){ if(error.migrationReport) state.migrationReport=error.migrationReport; throw error; }
  state.migrationReport=result;
  if(!result.retryRequired) localStorage.setItem(`fh3d_v4_migrated_${state.user.id}`,new Date().toISOString());
  if(result?.data) state.data={...state.data,...result.data};
  notify(`${result.retryRequired?"Migração parcial; tente novamente":"Migração concluída"}: ${result?.imported||0} registros importados, ${result?.corrected||0} corrigidos.`,result.retryRequired?"error":"success");
}

function handleRemoteChange(change){
  const collection=change.table||change.collection; if(!COLLECTIONS.includes(collection)) return;
  const rows=state.data[collection]||[]; const next=change.new||change.record; const old=change.old;
  const key=row=>collection==="settings"?row?.user_id:row?.id;
  if(change.eventType==="DELETE"||change.type==="DELETE") state.data[collection]=rows.filter(row=>key(row)!==key(old));
  else if(next){ const index=rows.findIndex(row=>key(row)===key(next)); state.data[collection]=index<0?[...rows,next]:rows.map((row,i)=>i===index?next:row); }
  state.settings={...DEFAULT_SETTINGS,...(state.data.settings?.[0]||{})}; renderAll();
}

function friendlyError(error){
  const raw=String(error?.message||error||"Erro inesperado.");
  const messages=[
    [/relation .* does not exist|could not find the table/i,"A estrutura V4 ainda não foi instalada no Supabase."],
    [/order_must_be_approved/i,"Aprove o orçamento antes de iniciar a produção."],
    [/insufficient_stock/i,"Estoque insuficiente para iniciar a produção."],
    [/filament_(unavailable|required)/i,"Selecione um filamento disponível para todos os itens."],
    [/delivered_order_(cannot_be_cancelled|is_final)/i,"Um pedido entregue não pode ser cancelado; registre reembolso ou ajuste."],
    [/cancel_active_order_before_archiving/i,"Cancele o pedido ativo antes de arquivá-lo."],
    [/invalid_production_transition/i,"Avance a produção uma etapa por vez."],
    [/version_conflict/i,"Outro aparelho alterou este registro. Os dados serão recarregados."],
    [/failed to fetch|network|tempo limite|timeout/i,"A nuvem não respondeu; a alteração ficará pendente neste aparelho."],
  ];
  return messages.find(([pattern])=>pattern.test(raw))?.[1]||raw;
}

function handleError(error,prefix="Erro"){
  console.error(error);
  if(error instanceof ConflictError || error?.code==="VERSION_CONFLICT") { setSyncStatus("conflict"); notify("Conflito detectado: outro aparelho alterou este registro. Os dados foram recarregados.","error"); loadData(); return; }
  notify(`${prefix}: ${friendlyError(error)}`,"error");
}

function renderAll(){ renderAccount(); renderDashboard(); renderQuote(); renderOrders(); renderDeadlines(); renderInventory(); renderExpenses(); renderCatalog(); renderSettings(); }
function renderAccount(){ const label=state.user?"Conta":"Entrar"; byId("accountButton").textContent=state.user?state.user.email:label; byId("mobileAccountButton").textContent=label; byId("authLoggedOut").classList.toggle("hidden",!!state.user); byId("authLoggedIn").classList.toggle("hidden",!state.user); byId("authIdentity").textContent=state.user?`Conectado como ${state.user.email}`:""; }

function renderDashboard(){
  const metrics=calculateDashboardMetrics({orders:decorateOrders(),expenses:activeRows("expenses"),filaments:activeRows("filaments"),referenceDate:new Date()});
  const upcoming=decorateOrders().filter(o=>o.due_date&&!o.archived_at&&o.commercial_status!=="cancelado"&&o.production_status!=="entregue").sort((a,b)=>String(a.due_date).localeCompare(String(b.due_date))).slice(0,5);
  byId("tab-dashboard").innerHTML=`<div class="grid four"><article class="card metric"><span>Recebido no mês</span><strong>${formatCurrency(metrics.receita||0)}</strong></article><article class="card metric"><span>A receber</span><strong>${formatCurrency(metrics.pendente||0)}</strong></article><article class="card metric"><span>Despesas do mês</span><strong>${formatCurrency(metrics.despesas||0)}</strong></article><article class="card metric"><span>Lucro líquido</span><strong>${formatCurrency(metrics.lucroLiquido||0)}</strong></article></div>
  <div class="grid two" style="margin-top:14px"><article class="card"><h2>Próximas entregas</h2>${upcoming.length?upcoming.map(o=>`<div class="split"><span><b>${h(o.project)}</b><br><small class="muted">${h(o.customer_name||"Sem cliente")}</small></span><span class="badge amber">${formatLocalDate(o.due_date)}</span></div>`).join(""):'<div class="empty">Nenhuma entrega programada</div>'}</article><article class="card"><h2>Estoque crítico</h2>${activeRows("filaments").filter(f=>Number(f.current_weight_g)<100).map(f=>`<div class="split"><span>${h(f.manufacturer)} · ${h(f.color)}</span><b class="danger-text">${Number(f.current_weight_g).toLocaleString("pt-BR")} g</b></div>`).join("")||'<div class="empty">Todos os filamentos estão acima de 100 g</div>'}</article></div>`;
}

function quoteItemHtml(item,index){
  const options=activeRows("filaments").filter(f=>!item.material||f.material===item.material).map(f=>`<option value="${f.id}" ${f.id===item.filamentId?"selected":""}>${h(f.manufacturer)} — ${h(f.color)} (${h(f.material)}) · ${Number(f.current_weight_g).toLocaleString("pt-BR")} g</option>`).join("");
  return `<div class="item-editor quote-item" data-index="${index}"><div class="split"><b>Item ${index+1}</b><button type="button" class="button danger" data-action="remove-quote-item" data-index="${index}">Remover</button></div><div class="form-grid"><label>Nome<input name="itemName" value="${h(item.name)}" required></label><label>Quantidade<input name="quantity" type="number" min="1" step="1" value="${h(item.quantity)}" required></label><label>Peso unitário do fatiador (g)<input name="unitWeightG" type="number" min="0.1" step="0.1" value="${h(item.unitWeightG)}" required></label><label>Tempo unitário (horas)<input name="printHours" type="number" min="0.01" step="0.01" value="${h(item.printHours)}" required></label><label>Material<select name="material">${["PLA","PETG","ABS","ASA","TPU","RESINA"].map(m=>`<option ${m===item.material?"selected":""}>${m}</option>`).join("")}</select></label><label>Filamento<select name="filamentId" required><option value="">Selecione</option>${options}</select></label></div></div>`;
}

function renderQuote(){
  const result=state.quote.result;
  const summary=result?`<div class="grid two"><div class="metric"><span>Custo estimado</span><strong>${formatCurrency(result.baseCost||0)}</strong></div><div class="metric"><span>Preço final</span><strong>${formatCurrency(result.finalPrice||0)}</strong></div><div class="metric"><span>Peso fatiado</span><strong>${Number(result.totalWeightG||0).toLocaleString("pt-BR")} g</strong></div><div class="metric"><span>Tempo total</span><strong>${result.totalHours||0}h ${result.totalMinutes||0}min</strong></div></div><p class="muted">O estoque só será baixado quando o pedido entrar em produção.</p>`:'<div class="empty">Preencha os itens e clique em Calcular.</div>';
  byId("tab-quote").innerHTML=`<div class="grid two"><form id="quoteForm" class="card stack"><div class="split"><div><h2>${state.quote.editingId?"Editar pedido":"Novo orçamento"}</h2><p class="muted">Calcule novamente sempre que alterar algum campo.</p></div>${state.quote.editingId?'<button type="button" data-action="new-quote" class="button secondary">Novo</button>':""}</div><div class="form-grid"><label>Cliente<input name="customerName" value="${h(state.quote.customerName||"")}"></label><label>WhatsApp do cliente<input name="customerPhone" inputmode="tel" value="${h(state.quote.customerPhone||"")}"></label><label>Projeto<input name="project" value="${h(state.quote.project||"")}" required></label><label>Impressora<select name="printer"><option value="K1C" ${(!state.quote.printer||state.quote.printer==="K1C")?"selected":""}>Creality K1C</option><option value="KOBRA" ${state.quote.printer==="KOBRA"?"selected":""}>Anycubic Kobra S1</option><option value="AMBAS" ${state.quote.printer==="AMBAS"?"selected":""}>Ambas</option></select></label><label>Prazo de entrega<input name="dueDate" type="date" value="${h(state.quote.dueDate||"")}"></label></div><label>Descrição do produto<textarea name="description">${h(state.quote.description||"")}</textarea></label><label>Observações para o cliente<textarea name="notes">${h(state.quote.notes||"")}</textarea></label><div id="quoteItems" class="stack">${state.quote.items.map(quoteItemHtml).join("")}</div><button type="button" data-action="add-quote-item" class="button secondary">Adicionar item</button><div class="form-grid"><label>Modelagem (R$)<input name="modeling" type="number" min="0" step="0.01" value="${h(state.quote.modeling||0)}"></label><label>Acabamento (R$)<input name="finishing" type="number" min="0" step="0.01" value="${h(state.quote.finishing||0)}"></label><label>Desconto (R$)<input name="discount" type="number" min="0" step="0.01" value="${h(state.quote.discount||0)}"></label><label>Fotos do produto<input id="quotePhotos" type="file" accept="image/jpeg,image/png,image/webp" multiple><small class="muted">Até 6 fotos; imagens grandes serão comprimidas.</small></label></div><div class="actions"><button type="button" data-action="calculate-quote" class="button primary">Calcular</button><button type="button" data-action="save-quote" class="button success" ${!result||state.quote.dirty?"disabled":""}>${state.quote.editingId?"Salvar alterações":"Salvar pedido"}</button></div></form><aside class="card"><h2>Resultado</h2>${summary}</aside></div>`;
}

function statusOptions(values,current){ return values.map(value=>`<option value="${value}" ${value===current?"selected":""}>${h(STATUS_LABELS[value]||value)}</option>`).join(""); }
function renderOrders(){
  const orders=decorateOrders().sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  const rows=orders.map(order=>{
    const locked=Boolean(order.archived_at),canEdit=!locked&&order.production_status==="pendente";
    const actions=locked
      ? `<button class="button secondary" data-action="pdf-order" data-id="${order.id}">PDF</button><button class="button success" data-action="restore-order" data-id="${order.id}">Restaurar</button>`
      : `<button class="button secondary" data-action="edit-order" data-id="${order.id}" ${canEdit?"":"disabled"}>Editar</button><button class="button secondary" data-action="pdf-order" data-id="${order.id}">PDF</button><button class="button danger" data-action="archive-order" data-id="${order.id}">Arquivar</button>`;
    return `<tr data-order-id="${order.id}" class="${locked?"archived-row hidden":""}"><td>${formatLocalDate(order.created_at)}</td><td><b>${h(order.customer_name||"—")}</b><br>${h(order.project)}</td><td>${formatCurrency(order.final_price)}</td><td><select data-action="commercial-status" data-id="${order.id}" ${locked?"disabled":""}>${statusOptions(COMMERCIAL_STATUSES,order.commercial_status)}</select></td><td><select data-action="production-status" data-id="${order.id}" ${locked?"disabled":""}>${statusOptions(PRODUCTION_STATUSES,order.production_status)}</select></td><td><select data-action="payment-status" data-id="${order.id}" ${locked?"disabled":""}>${statusOptions(PAYMENT_STATUSES,order.payment_status)}</select></td><td><div class="actions">${actions}</div></td></tr>`;
  }).join("");
  byId("tab-orders").innerHTML=`<article class="card"><div class="split"><div><h2>Controle de pedidos</h2><p class="muted">Produção, pagamento e situação comercial são independentes.</p></div><label>Mostrar arquivados<input id="showArchived" type="checkbox"></label></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Cliente / projeto</th><th>Valor</th><th>Comercial</th><th>Produção</th><th>Pagamento</th><th>Ações</th></tr></thead><tbody>${rows||'<tr><td colspan="7" class="empty">Nenhum pedido cadastrado</td></tr>'}</tbody></table></div></article>`;
}

function renderDeadlines(){
  const orders=decorateOrders().filter(o=>o.due_date&&o.commercial_status!=="cancelado"&&!o.archived_at).sort((a,b)=>String(a.due_date).localeCompare(String(b.due_date)));
  const tasks=activeRows("tasks").sort((a,b)=>String(a.due_date).localeCompare(String(b.due_date)));
  byId("tab-deadlines").innerHTML=`<div class="grid two"><article class="card"><h2>Prazos dos pedidos</h2><div class="stack">${orders.map(o=>`<div class="item-editor split"><span><b>${h(o.project)}</b><br><small class="muted">${h(o.customer_name||"—")} · ${h(STATUS_LABELS[o.production_status]||o.production_status)}</small></span><span class="badge amber">${formatLocalDate(o.due_date)}</span></div>`).join("")||'<div class="empty">Nenhum prazo de pedido</div>'}</div></article><article class="card"><h2>Tarefas avulsas</h2><form id="taskForm" class="form-grid"><label>Tarefa<input name="title" required></label><label>Prazo<input name="dueDate" type="date" required></label><label>Observações<input name="notes"></label><button class="button primary" data-action="add-task" type="button">Adicionar</button></form><div class="stack" style="margin-top:12px">${tasks.map(t=>`<div class="item-editor split"><span><b>${h(t.title)}</b><br><small>${h(t.notes||"")}</small></span><span><span class="badge">${formatLocalDate(t.due_date)}</span> <button class="button danger" data-action="delete-task" data-id="${t.id}">Excluir</button></span></div>`).join("")}</div></article></div>`;
}

function renderInventory(){
  const filaments=activeRows("filaments").sort((a,b)=>`${a.material}${a.color}`.localeCompare(`${b.material}${b.color}`));
  byId("tab-inventory").innerHTML=`<div class="grid two"><form id="filamentForm" class="card stack"><h2>Cadastrar filamento</h2><input type="hidden" name="id"><div class="form-grid"><label>Fabricante<input name="manufacturer" required></label><label>Cor<input name="color" required></label><label>Material<select name="material">${["PLA","PETG","ABS","ASA","TPU","RESINA"].map(m=>`<option>${m}</option>`).join("")}</select></label><label>Peso atual (g)<input name="currentWeightG" type="number" min="0" step="0.1" required></label><label>Preço/kg (R$)<input name="priceKg" type="number" min="0" step="0.01" required></label></div><button type="button" data-action="save-filament" class="button primary">Salvar filamento</button></form><article class="card"><h2>Resumo</h2><div class="metric"><span>Peso disponível</span><strong>${(filaments.reduce((sum,f)=>sum+Number(f.current_weight_g||0),0)/1000).toLocaleString("pt-BR",{maximumFractionDigits:2})} kg</strong></div><p class="muted">Ajustes manuais e produção geram movimentos auditáveis.</p></article></div><article class="card" style="margin-top:14px"><div class="table-wrap"><table><thead><tr><th>Filamento</th><th>Material</th><th>Saldo</th><th>Preço/kg</th><th>Ações</th></tr></thead><tbody>${filaments.map(f=>`<tr><td><b>${h(f.manufacturer)}</b><br>${h(f.color)}</td><td>${h(f.material)}</td><td>${Number(f.current_weight_g).toLocaleString("pt-BR")} g</td><td>${formatCurrency(f.price_kg)}</td><td><button class="button secondary" data-action="edit-filament" data-id="${f.id}">Editar</button> <button class="button danger" data-action="archive-filament" data-id="${f.id}">Arquivar</button></td></tr>`).join("")||'<tr><td colspan="5" class="empty">Nenhum filamento cadastrado</td></tr>'}</tbody></table></div></article>`;
}

function renderExpenses(){
  const expenses=activeRows("expenses").sort((a,b)=>String(b.expense_date).localeCompare(String(a.expense_date)));
  const recurring=activeRows("recurring_expenses");
  byId("tab-expenses").innerHTML=`<div class="grid two"><form id="expenseForm" class="card stack"><h2>Nova despesa</h2><div class="form-grid"><label>Data<input name="date" type="date" required></label><label>Descrição<input name="description" required></label><label>Categoria<input name="category" value="Outros"></label><label>Valor<input name="amount" type="number" min="0.01" step="0.01" required></label></div><button type="button" data-action="save-expense" class="button primary">Adicionar</button></form><form id="recurringForm" class="card stack"><h2>Conta recorrente</h2><div class="form-grid"><label>Descrição<input name="description" required></label><label>Categoria<input name="category" value="Fixa"></label><label>Valor<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Dia do mês<input name="day" type="number" min="1" max="31" required></label></div><button type="button" data-action="save-recurring" class="button primary">Salvar recorrente</button></form></div><div class="grid two" style="margin-top:14px"><article class="card"><h2>Lançamentos</h2>${expenses.map(e=>`<div class="item-editor split"><span><b>${h(e.description)}</b><br><small>${formatLocalDate(e.expense_date)} · ${h(e.category)}</small></span><span>${formatCurrency(e.amount)} <button class="button danger" data-action="delete-expense" data-id="${e.id}">Excluir</button></span></div>`).join("")||'<div class="empty">Sem despesas</div>'}</article><article class="card"><h2>Recorrentes</h2>${recurring.map(e=>`<div class="item-editor split"><span><b>${h(e.description)}</b><br><small>Todo dia ${e.day_of_month}</small></span><span>${formatCurrency(e.amount)} <button class="button danger" data-action="delete-recurring" data-id="${e.id}">Excluir</button></span></div>`).join("")||'<div class="empty">Sem contas recorrentes</div>'}</article></div>`;
  const dateInput=byId("expenseForm")?.elements?.date; if(dateInput&&!dateInput.value) dateInput.value=toSaoPauloDateKey(new Date());
}

function renderCatalog(){
  const products=activeRows("catalog_products"),calibrations=activeRows("calibrations");
  const productRows=products.map(p=>`<div class="item-editor split"><span><b>${h(p.name)}</b><br><small>${h(p.category||"")} · ${Number(p.unit_weight_g||0).toLocaleString("pt-BR")} g · ${Number(p.print_hours||0).toLocaleString("pt-BR")} h</small></span><span class="actions"><button class="button primary" data-action="use-product" data-id="${p.id}">Usar</button><button class="button danger" data-action="archive-product" data-id="${p.id}">Arquivar</button></span></div>`).join("");
  const calibrationRows=calibrations.map(c=>`<div class="item-editor split"><span><b>${h(c.name)}</b><br><small>${h(c.printer)} · ${h(c.material)} · ${Number(c.temperature_c||0).toLocaleString("pt-BR")}°C</small></span><span class="actions"><button class="button secondary" data-action="use-calibration" data-id="${c.id}">Aplicar</button><button class="button danger" data-action="delete-calibration" data-id="${c.id}">Excluir</button></span></div>`).join("");
  byId("tab-catalog").innerHTML=`<div class="grid two"><form id="productForm" class="card stack"><h2>Produto padrão</h2><div class="form-grid"><label>Nome<input name="name" required></label><label>Categoria<input name="category"></label><label>Peso (g)<input name="weight" type="number" min="0.1" step="0.1" required></label><label>Tempo (h)<input name="hours" type="number" min="0.01" step="0.01" required></label><label>Material<select name="material">${["PLA","PETG","ABS","ASA","TPU","RESINA"].map(m=>`<option>${m}</option>`).join("")}</select></label></div><button type="button" data-action="save-product" class="button primary">Adicionar produto</button></form><form id="calibrationForm" class="card stack"><h2>Calibração</h2><div class="form-grid"><label>Nome<input name="name" required></label><label>Impressora<select name="printer"><option>K1C</option><option>KOBRA</option></select></label><label>Material<input name="material" required></label><label>Temperatura (°C)<input name="temperature" type="number" required></label><label>Camada (mm)<input name="layer" type="number" min="0.01" step="0.01" required></label><label>Velocidade (mm/s)<input name="speed" type="number" min="1" required></label></div><button type="button" data-action="save-calibration" class="button primary">Salvar calibração</button></form></div><div class="grid two" style="margin-top:14px"><article class="card"><h2>Catálogo</h2>${productRows||'<div class="empty">Sem produtos</div>'}</article><article class="card"><h2>Calibrações</h2>${calibrationRows||'<div class="empty">Sem calibrações</div>'}</article></div>`;
}

function renderSettings(){
  const s=settingsRow(),numberValue=(key,fallback)=>h(s[key]??fallback);
  const migration=state.migrationReport?`<div class="notice ${state.migrationReport.rejected?"error":"success"}">Migração: ${state.migrationReport.imported||0} importados; ${state.migrationReport.corrected||0} corrigidos; ${state.migrationReport.rejected||0} rejeitados.</div>`:"";
  byId("tab-settings").innerHTML=`<form id="settingsForm" class="card stack"><h2>Configurações do estúdio</h2><div class="form-grid"><label>Nome<input name="studioName" value="${h(s.studio_name||"")}"></label><label>WhatsApp<input name="whatsapp" value="${h(s.whatsapp||"")}"></label><label>E-mail<input name="email" type="email" value="${h(s.email||"")}"></label><label>Instagram<input name="instagram" value="${h(s.instagram||"")}"></label><label>Chave PIX<input name="pixKey" value="${h(s.pix_key||"")}"></label><label>Titular PIX<input name="pixHolder" value="${h(s.pix_holder||"")}"></label><label>Custo padrão filamento/kg<input name="filamentCost" type="number" min="0" step="0.01" value="${numberValue("filament_cost_kg",95)}"></label><label>Energia/kWh<input name="energy" type="number" min="0" step="0.01" value="${numberValue("energy_kwh",.85)}"></label><label>Consumo K1C (kW)<input name="k1c" type="number" min="0" step="0.01" value="${numberValue("k1c_kw",.25)}"></label><label>Consumo Kobra (kW)<input name="kobra" type="number" min="0" step="0.01" value="${numberValue("kobra_kw",.3)}"></label><label>Depreciação/hora<input name="depreciation" type="number" min="0" step="0.01" value="${numberValue("depreciation_hour",2.5)}"></label><label>Manutenção/hora<input name="maintenance" type="number" min="0" step="0.01" value="${numberValue("maintenance_hour",.5)}"></label><label>Lucro padrão (%)<input name="profit" type="number" min="0" step="1" value="${numberValue("profit_percent",30)}"></label><label>Embalagem<input name="packaging" type="number" min="0" step="0.01" value="${numberValue("packaging_cost",10)}"></label></div><label>Modificações<textarea name="modificationTerms">${h(s.modification_terms||"")}</textarea></label><label>Validade<textarea name="validityTerms">${h(s.validity_terms||"")}</textarea></label><label>Observações gerais<textarea name="generalNotes">${h(s.general_notes||"")}</textarea></label><label>Logo<input id="logoFile" type="file" accept="image/png,image/jpeg,image/webp"><small class="muted">${s.logo_path?"Logo salvo na nuvem.":"Nenhum logo salvo."}</small></label><div class="actions"><button type="button" data-action="save-settings" class="button primary">Salvar configurações</button><button type="button" data-action="export-backup" class="button secondary">Exportar backup</button></div>${migration}</form>`;
  const syncLabel={synced:"Sincronizado",pending:"Pendente",offline:"Offline",conflict:"Conflito"}[state.sync.status]||state.sync.status;
  byId("tab-settings").insertAdjacentHTML("beforeend",`<article class="card stack" style="margin-top:14px"><h2>Sincronização</h2><p class="muted">Estado atual: <b>${h(syncLabel)}</b>${state.sync.message?` — ${h(state.sync.message)}`:""}</p><div class="actions"><button type="button" data-action="retry-sync" class="button secondary">Tentar novamente</button><button type="button" data-action="discard-pending" class="button danger">Descartar pendências e usar a nuvem</button></div><small class="muted">Ao descartar, um backup JSON é baixado antes de remover a fila local desta conta.</small></article>`);
}

function collectQuote(){
  const form=byId("quoteForm"); const fd=new FormData(form); const filaments=filamentMap();
  const items=[...form.querySelectorAll(".quote-item")].map(row=>{ const filamentId=row.querySelector('[name="filamentId"]').value; const filament=filaments.get(filamentId); return { clientId:state.quote.items[Number(row.dataset.index)]?.clientId||uid(), name:row.querySelector('[name="itemName"]').value.trim(), quantity:Number(row.querySelector('[name="quantity"]').value), unitWeightG:Number(row.querySelector('[name="unitWeightG"]').value), printHours:Number(row.querySelector('[name="printHours"]').value), material:row.querySelector('[name="material"]').value, filamentId, filamentPriceKg:Number(filament?.price_kg||state.settings.filament_cost_kg) }; });
  state.quote={...state.quote,customerName:String(fd.get("customerName")||"").trim(),customerPhone:String(fd.get("customerPhone")||"").trim(),project:String(fd.get("project")||"").trim(),printer:String(fd.get("printer")||"K1C"),dueDate:String(fd.get("dueDate")||""),description:String(fd.get("description")||"").trim(),notes:String(fd.get("notes")||"").trim(),modeling:Number(fd.get("modeling")||0),finishing:Number(fd.get("finishing")||0),discount:Number(fd.get("discount")||0),items}; return state.quote;
}

async function calculateCurrentQuote(){ requireValidForm("quoteForm"); const draft=collectQuote(); if(!draft.project) throw new Error("Informe o projeto."); const validation=validateQuoteItems(draft.items); if(!validation.valid) throw new Error(validation.errors.map(error=>error.message).join(" ")); const costs={filamentPriceKg:state.settings.filament_cost_kg,energyRateKwh:state.settings.energy_kwh,k1cConsumptionKw:state.settings.k1c_kw,kobraConsumptionKw:state.settings.kobra_kw,depreciationPerHour:state.settings.depreciation_hour,maintenancePerHour:state.settings.maintenance_hour,profitPercent:state.settings.profit_percent,packaging:state.settings.packaging_cost}; const result=calculateQuote({items:draft.items,costs,printer:draft.printer,modeling:draft.modeling,finishing:draft.finishing,discount:draft.discount}); state.quote.result=result; state.quote.dirty=false; renderQuote(); }
async function saveCurrentQuote(){
  if(!state.user) throw new Error("Entre na sua conta antes de salvar."); if(state.quote.dirty||!state.quote.result) throw new Error("Calcule novamente antes de salvar."); const q=state.quote; const old=q.editingId?orderById(q.editingId):null;
  const orderId=old?.id||q.orderId||uid(); state.quote.orderId=orderId;
  const order={id:orderId,customer_name:q.customerName,customer_phone:q.customerPhone,project:q.project,description:q.description,notes:q.notes,printer:q.printer,due_date:q.dueDate||null,commercial_status:old?.commercial_status||"orcamento",production_status:old?.production_status||"pendente",payment_status:old?.payment_status||"pendente",final_price:q.result.finalPrice??q.result.precoFinal,total_cost:q.result.baseCost??q.result.custoBase,modeling_price:q.modeling,finishing_price:q.finishing,discount:q.discount,created_at:old?.created_at||q.createdAt||new Date().toISOString(),version:old?.version||0}; state.quote.createdAt=order.created_at;
  const items=q.items.map(item=>{item.dbId=item.dbId||uid();return {id:item.dbId,order_id:order.id,name:item.name,quantity:item.quantity,unit_weight_g:item.unitWeightG,print_hours:item.printHours,material:item.material,filament_id:item.filamentId,filament_price_kg:item.filamentPriceKg};});
  const saved=await repo.rpc("save_order",{p_order:order,p_items:items,p_expected_version:old?.version??null});
  state.quote.editingId=order.id;
  if(q.photos?.length) for(let index=0;index<q.photos.length;index+=1){ const file=await compressImage(q.photos[index]); q.photoIds[index]=q.photoIds[index]||uid(); await repo.uploadAttachment(file,state.user.id,order.id,"product_photo",{id:q.photoIds[index]}); }
  await loadData(); resetQuote(); notify(old?"Pedido atualizado.":"Pedido salvo."); switchTab("orders"); return saved;
}
function resetQuote(){ state.quote={items:[newQuoteItem()],dirty:true,result:null,editingId:null,orderId:null,photos:[],photoIds:[]}; renderQuote(); }

async function setOrderStatus(kind,id,value){
  const order=orderById(id); if(!order) return;
  if(kind==="production"&&value==="em_producao"&&order.production_status==="pendente"){
    if(order.commercial_status!=="aprovado") throw new Error("Aprove o orçamento antes de iniciar a produção.");
    if(!await confirmAction("Iniciar produção","O consumo agregado dos filamentos será baixado agora.")){renderOrders();return;}
    await repo.rpc("start_order_production",{p_order_id:id,p_expected_version:order.version});
  }
  else if(kind==="commercial"&&value==="cancelado"){
    if(!await confirmAction("Cancelar pedido","Se o estoque já foi consumido, ele será devolvido uma única vez.")){renderOrders();return;}
    await repo.rpc("cancel_order",{p_order_id:id,p_expected_version:order.version});
  }
  else if(kind==="commercial"&&order.commercial_status==="cancelado"&&value!=="cancelado") await repo.rpc("reopen_order",{p_order_id:id,p_expected_version:order.version});
  else if(kind==="production"&&value!==order.production_status&&PRODUCTION_STATUSES.indexOf(value)!==PRODUCTION_STATUSES.indexOf(order.production_status)+1) throw new Error("Avance a produção uma etapa por vez. Para reiniciar, cancele e reabra o pedido.");
  else { const patch={...order,[`${kind}_status`]:value}; if(kind==="payment") patch.paid_at=value==="pago"?new Date().toISOString():null; await repo.upsert("orders",patch,{expectedVersion:order.version}); }
  await loadData(); notify("Status atualizado.");
}

function editOrder(id){ const order=orderById(id); if(!order)return; if(order.production_status!=="pendente") throw new Error("Cancele e reabra o pedido antes de alterar itens que já consumiram estoque."); const items=orderItems(id); state.quote={editingId:id,orderId:id,createdAt:order.created_at,dirty:true,result:null,customerName:order.customer_name||"",customerPhone:order.customer_phone||"",project:order.project||"",description:order.description||"",notes:order.notes||"",printer:order.printer||"K1C",dueDate:order.due_date||"",modeling:order.modeling_price||0,finishing:order.finishing_price||0,discount:order.discount||0,photos:[],photoIds:[],items:items.map(i=>newQuoteItem({dbId:i.id,name:i.name,quantity:i.quantity,unitWeightG:i.unit_weight_g,printHours:i.print_hours,material:i.material,filamentId:i.filament_id}))}; switchTab("quote"); }
async function createPdf(id){
  const order=orderById(id); if(!order) throw new Error("Pedido não encontrado.");
  const popup=window.open("","_blank"); if(!popup) throw new Error("O navegador bloqueou a janela do PDF. Libere pop-ups para este site.");
  popup.document.write('<!doctype html><meta charset="utf-8"><title>Preparando PDF</title><p style="font-family:Arial;padding:24px">Preparando orçamento...</p>');
  try{
    const attachments=await Promise.all(orderAttachments(id).map(async file=>({...file,url:file.url||await repo.getAttachmentUrl(file.storage_path)})));
    const settings={...settingsRow()}; if(settings.logo_path&&!settings.logo_url) settings.logo_url=await repo.getAttachmentUrl(settings.logo_path);
    generateOrderPdf({order,items:orderItems(id),settings,attachments},popup);
  }catch(error){ popup.close(); throw error; }
}

function switchTab(tab){ state.activeTab=tab; document.querySelectorAll(".tabs button").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab)); document.querySelectorAll(".panel").forEach(p=>p.classList.toggle("active",p.id===`tab-${tab}`)); }
async function confirmAction(title,text){ return new Promise(resolve=>{ const dialog=byId("confirmDialog"); byId("confirmTitle").textContent=title; byId("confirmText").textContent=text; const close=()=>{dialog.removeEventListener("close",close);resolve(dialog.returnValue==="default");};dialog.addEventListener("close",close);dialog.showModal(); }); }

async function handleAction(action,el){
  if(state.busy)return;
  try{
    if(action==="add-quote-item"){ collectQuote(); state.quote.items.push(newQuoteItem()); state.quote.dirty=true; renderQuote(); }
    else if(action==="open-account") byId("authDialog").showModal();
    else if(action==="remove-quote-item"){ collectQuote(); if(state.quote.items.length>1)state.quote.items.splice(Number(el.dataset.index),1); state.quote.dirty=true; renderQuote(); }
    else if(action==="new-quote") resetQuote();
    else if(action==="calculate-quote") await calculateCurrentQuote();
    else if(action==="save-quote") await saveCurrentQuote();
    else if(action==="edit-order") editOrder(el.dataset.id);
    else if(action==="pdf-order") await createPdf(el.dataset.id);
    else if(action==="archive-order"){ const order=orderById(el.dataset.id); if(!["orcamento","cancelado"].includes(order.commercial_status)) throw new Error("Cancele o pedido ativo antes de arquivar."); if(await confirmAction("Arquivar pedido","Ele ficará oculto, mas o histórico será preservado.")){await repo.rpc("archive_order",{p_order_id:order.id,p_expected_version:order.version});await loadData();} }
    else if(action==="restore-order"){ const order=state.data.orders.find(o=>o.id===el.dataset.id); await repo.rpc("restore_order",{p_order_id:order.id,p_expected_version:order.version}); await loadData(); }
    else if(action==="save-filament"){ const form=requireValidForm("filamentForm"),f=new FormData(form),id=f.get("id")||uid(),old=activeRows("filaments").find(row=>row.id===id); await repo.rpc("save_filament",{p_filament:{id,manufacturer:String(f.get("manufacturer")).trim(),color:String(f.get("color")).trim(),material:f.get("material"),current_weight_g:Number(f.get("currentWeightG")),price_kg:Number(f.get("priceKg"))},p_expected_version:old?.version??null}); await loadData(); form.reset(); notify("Filamento salvo."); }
    else if(action==="edit-filament"){ const f=activeRows("filaments").find(x=>x.id===el.dataset.id),form=byId("filamentForm"); form.elements.id.value=f.id;form.elements.manufacturer.value=f.manufacturer;form.elements.color.value=f.color;form.elements.material.value=f.material;form.elements.currentWeightG.value=f.current_weight_g;form.elements.priceKg.value=f.price_kg; }
    else if(action==="archive-filament"){ const f=activeRows("filaments").find(x=>x.id===el.dataset.id); await repo.upsert("filaments",{...f,archived_at:new Date().toISOString()},{expectedVersion:f.version}); await loadData(); }
    else if(action==="add-task"){ const form=requireValidForm("taskForm"),f=new FormData(form); await repo.upsert("tasks",{id:uid(),title:String(f.get("title")).trim(),due_date:f.get("dueDate"),notes:String(f.get("notes")||"")});await loadData(); }
    else if(action==="delete-task") { const row=activeRows("tasks").find(x=>x.id===el.dataset.id); await repo.remove("tasks",row.id,{soft:true,version:row.version});await loadData(); }
    else if(action==="save-expense"){const form=requireValidForm("expenseForm"),f=new FormData(form);await repo.upsert("expenses",{id:uid(),expense_date:f.get("date"),description:String(f.get("description")).trim(),category:String(f.get("category")||"Outros"),amount:Number(f.get("amount"))});await loadData();}
    else if(action==="delete-expense"){const row=activeRows("expenses").find(x=>x.id===el.dataset.id);await repo.remove("expenses",row.id,{soft:true,version:row.version});await loadData();}
    else if(action==="save-recurring"){const form=requireValidForm("recurringForm"),f=new FormData(form);await repo.upsert("recurring_expenses",{id:uid(),description:String(f.get("description")).trim(),category:String(f.get("category")||"Fixa"),amount:Number(f.get("amount")),day_of_month:Number(f.get("day")),active:true});await loadData();}
    else if(action==="delete-recurring"){const row=activeRows("recurring_expenses").find(x=>x.id===el.dataset.id);await repo.remove("recurring_expenses",row.id,{soft:true,version:row.version});await loadData();}
    else if(action==="save-product"){const form=requireValidForm("productForm"),f=new FormData(form);await repo.upsert("catalog_products",{id:uid(),name:String(f.get("name")).trim(),category:String(f.get("category")||""),unit_weight_g:Number(f.get("weight")),print_hours:Number(f.get("hours")),material:f.get("material")});await loadData();}
    else if(action==="use-product"){const p=activeRows("catalog_products").find(x=>x.id===el.dataset.id);state.quote.items=[newQuoteItem({name:p.name,unitWeightG:p.unit_weight_g,printHours:p.print_hours,material:p.material})];state.quote.dirty=true;switchTab("quote");renderQuote();}
    else if(action==="archive-product"){const row=activeRows("catalog_products").find(x=>x.id===el.dataset.id);await repo.upsert("catalog_products",{...row,active:false},{expectedVersion:row.version});await loadData();}
    else if(action==="save-calibration"){const form=requireValidForm("calibrationForm"),f=new FormData(form);await repo.upsert("calibrations",{id:uid(),name:String(f.get("name")).trim(),printer:f.get("printer"),material:String(f.get("material")),temperature_c:Number(f.get("temperature")),layer_height_mm:Number(f.get("layer")),speed_mm_s:Number(f.get("speed"))});await loadData();}
    else if(action==="use-calibration"){const row=activeRows("calibrations").find(x=>x.id===el.dataset.id);state.quote.printer=row.printer||state.quote.printer;state.quote.items=state.quote.items.map(item=>({...item,material:row.material||item.material,filamentId:""}));state.quote.dirty=true;switchTab("quote");renderQuote();notify("Calibração aplicada ao orçamento.");}
    else if(action==="delete-calibration"){const row=activeRows("calibrations").find(x=>x.id===el.dataset.id);await repo.remove("calibrations",row.id,{soft:true,version:row.version});await loadData();}
    else if(action==="save-settings") await saveSettings();
    else if(action==="export-backup") downloadJson(`precificador-v4-backup-${Date.now()}.json`,{exportedAt:new Date().toISOString(),data:state.data});
    else if(action==="retry-sync"){await repo.replayQueue();await loadData();notify("Sincronização verificada.");}
    else if(action==="discard-pending"){if(!repo.discardPendingOperations)throw new Error("A resolução de conflito ainda não está disponível.");if(await confirmAction("Usar dados da nuvem","Um backup será baixado e as alterações locais pendentes desta conta serão descartadas.")){downloadJson(`precificador-v4-conflito-${Date.now()}.json`,{exportedAt:new Date().toISOString(),sync:state.sync,data:state.data});await repo.discardPendingOperations();await loadData();notify("Pendências descartadas; dados da nuvem recarregados.");}}
  }catch(error){handleError(error);}
}

async function saveSettings(){requireValidForm("settingsForm");const f=new FormData(byId("settingsForm"));let row={...(state.data.settings[0]||{}),studio_name:String(f.get("studioName")),whatsapp:String(f.get("whatsapp")),email:String(f.get("email")),instagram:String(f.get("instagram")),pix_key:String(f.get("pixKey")),pix_holder:String(f.get("pixHolder")),filament_cost_kg:Number(f.get("filamentCost")),energy_kwh:Number(f.get("energy")),k1c_kw:Number(f.get("k1c")),kobra_kw:Number(f.get("kobra")),depreciation_hour:Number(f.get("depreciation")),maintenance_hour:Number(f.get("maintenance")),profit_percent:Number(f.get("profit")),packaging_cost:Number(f.get("packaging")),modification_terms:String(f.get("modificationTerms")),validity_terms:String(f.get("validityTerms")),general_notes:String(f.get("generalNotes"))};delete row.id;delete row.logo_url;const original=byId("logoFile").files[0];if(original){const logo=await compressImage(original,{maxDimension:1200,quality:.86});const asset=await repo.uploadAttachment(logo,state.user.id,null,"logo");row.logo_path=asset.storage_path;}await repo.upsert("settings",row,{expectedVersion:row.version});await loadData();notify("Configurações salvas.");}
function downloadJson(name,data){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}

document.addEventListener("click",async event=>{const tab=event.target.closest("[data-tab]");if(tab){switchTab(tab.dataset.tab);return;}const action=event.target.closest("[data-action]");if(!action)return;const key=`${action.dataset.action}:${action.dataset.id||action.dataset.index||"global"}`;if(state.actionLocks.has(key))return;state.actionLocks.add(key);try{await handleAction(action.dataset.action,action);}finally{state.actionLocks.delete(key);}});
document.addEventListener("submit",event=>{if(event.target.closest("main"))event.preventDefault();});
document.addEventListener("input",event=>{if(event.target.closest("#quoteForm")){collectQuote();state.quote.dirty=true;state.quote.result=null;const save=document.querySelector('[data-action="save-quote"]');if(save)save.disabled=true;}});
document.addEventListener("change",async event=>{const action=event.target.dataset.action,key=action?`${action}:${event.target.dataset.id||"global"}`:null;if(key&&state.actionLocks.has(key))return;if(key)state.actionLocks.add(key);try{if(action==="production-status")await setOrderStatus("production",event.target.dataset.id,event.target.value);else if(action==="payment-status")await setOrderStatus("payment",event.target.dataset.id,event.target.value);else if(action==="commercial-status")await setOrderStatus("commercial",event.target.dataset.id,event.target.value);else if(event.target.id==="quotePhotos"){state.quote.photos=[...event.target.files].slice(0,6);state.quote.photoIds=[];}else if(event.target.id==="showArchived")document.querySelectorAll(".archived-row").forEach(row=>row.classList.toggle("hidden",!event.target.checked));else if(event.target.name==="material"&&event.target.closest(".quote-item")){collectQuote();renderQuote();}}catch(error){handleError(error);if(action?.endsWith("-status"))renderOrders();}finally{if(key)state.actionLocks.delete(key);}});
byId("accountButton").addEventListener("click",()=>byId("authDialog").showModal());
byId("signInButton").addEventListener("click",async()=>{try{const result=await repo.signIn(byId("authEmail").value.trim(),byId("authPassword").value);state.user=result.user||result.session?.user;byId("authDialog").close();await loadData();}catch(error){handleError(error,"Falha ao entrar");}});
byId("signUpButton").addEventListener("click",async()=>{try{const result=await repo.signUp(byId("authEmail").value.trim(),byId("authPassword").value);if(!result.session)notify("Conta criada. Confirme o e-mail e depois entre.");else{state.user=result.user;await loadData();}byId("authDialog").close();}catch(error){handleError(error,"Falha ao criar conta");}});
byId("signOutButton").addEventListener("click",async()=>{state.unsubscribe?.();state.unsubscribe=null;await repo.signOut();state.user=null;state.data=structuredClone(EMPTY_DATA);resetQuote();renderAll();byId("authDialog").close();setSyncStatus("offline");});

async function init(){renderAll();navigator.serviceWorker?.register("./sw.js").catch(error=>console.warn("Service worker indisponível",error));if(!supabaseClient){notify("A biblioteca do Supabase não carregou. Verifique a conexão.","error");return;}try{const session=await repo.getSession();state.user=session?.user||session?.session?.user||null;if(state.user)await loadData();else renderAll();supabaseClient.auth.onAuthStateChange((event,sessionData)=>setTimeout(async()=>{if(event==="SIGNED_OUT"){state.unsubscribe?.();state.unsubscribe=null;state.user=null;state.data=structuredClone(EMPTY_DATA);resetQuote();renderAll();}else if(sessionData?.user&&sessionData.user.id!==state.user?.id){state.unsubscribe?.();state.unsubscribe=null;state.data=structuredClone(EMPTY_DATA);resetQuote();state.user=sessionData.user;await loadData();}},0));}catch(error){handleError(error,"Falha ao iniciar");}}
init();
