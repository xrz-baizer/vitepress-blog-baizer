'use strict';
const C=LedgerCore,$=s=>document.querySelector(s),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=(n,d=2)=>n===null?'—':Number(n).toLocaleString('zh-CN',{minimumFractionDigits:0,maximumFractionDigits:Math.min(2,d)});
const priceText=n=>n===null?'—':Number(n).toLocaleString('zh-CN',{minimumFractionDigits:0,maximumFractionDigits:3});
const priceInput=n=>Math.round((n+Number.EPSILON)*1000)/1000;
const marketWan=n=>n===null?'—':money(n/10000);
const signed=n=>n===null?'—':`${n<0?'-':''}${money(Math.abs(n))}`,color=n=>n>0?'gain':n<0?'loss':'neutral';
let state=C.empty(),db,revision=0,busy=false,ready=false,tableResizeObserver;
const t=(key,params)=>I18n.t(key,params);
const modal=$('#modal'),getStock=(data,id)=>{const s=data.stocks.find(s=>s.id===id);if(!s)throw Error(t("股票不存在。"));return s;};
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),4000);}
function openDialog(title,sub,body,submit,handler,extra='',wide=false){
 modal.classList.toggle('wide',wide);$('#modal-content').innerHTML=`<form id="dialog-form"><div class="modal-head"><h2>${title}</h2><button type="button" data-action="close" aria-label="${t("关闭")}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5L15 15M15 5L5 15"/></svg></button></div>${sub?`<p class="hint">${sub}</p>`:''}${body}<div id="form-error" role="alert"></div><div class="modal-foot">${extra}<button type="button" data-action="close">${t("取消")}</button><button class="primary" type="submit">${submit}</button></div></form>`;
 syncSteppers($('#dialog-form'));
 $('#dialog-form').querySelectorAll('[data-date-text]').forEach(validateDateInput);
 if(!modal.open)modal.showModal();$('#dialog-form').onsubmit=async e=>{e.preventDefault();if(busy)return;const btn=e.submitter;btn.disabled=true;try{await handler(readForm(e.target));}catch(err){$('#form-error').textContent=I18n.error(err.message);}finally{btn.disabled=false;}};
}
function readForm(form){const data=new FormData(form);form.querySelectorAll('input[data-raw-value]').forEach(el=>{if(!el.dataset.dirty&&el.name)data.set(el.name,el.dataset.rawValue);});return data;}
const field=(label,name,value,opts='')=>{
 const rounded=typeof value==='number'?/price/.test(name)?priceInput(value):/cash|budget|amount/.test(name)?C.round(value):value:value,raw=rounded!==value?`data-raw-value="${esc(value)}"`:'';
 const stepped=['price','base-price','hands','base-hands','mobile-target-hands'].includes(name),isPrice=name.includes('price'),id=`field-${name}`;
 const input=`<input id="${id}" name="${name}" value="${esc(rounded??'')}" ${raw} ${opts} ${stepped?`data-step-size="${isPrice ? .01 : 1}" ${/\bmax=/.test(opts)?'':'max="10000000"'}`:''}>`;
 const controls=stepped?`<div class="number-control">${input}<div class="number-step-buttons">${[-1,1].map(direction=>{const text=t(isPrice?(direction>0?'增加0.01元':'减少0.01元'):(direction>0?'增加1手':'减少1手'));return `<button type="button" data-step-direction="${direction}" aria-controls="${id}" aria-label="${esc(label+' · '+text)}" title="${text}">${direction>0?'＋':'−'}</button>`;}).join('')}</div></div>`:input;
 return `<div class="field"><label for="${id}">${label}</label>${controls}</div>`;
};
function buyDateField(value,required){
 return `<div class="compact-date-field"><label for="field-date">${t('买入日期')}</label><div class="compact-date-control"><input id="field-date" name="date" type="text" data-date-text value="${esc(value)}" placeholder="YYYY-MM-DD" pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}" maxlength="10" autocomplete="off" spellcheck="false" ${required?'required':''}><button type="button" class="compact-date-picker" data-date-picker aria-label="${t('选择买入日期')}" title="${t('选择买入日期')}"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4.5" width="14" height="13" rx="2"/><path d="M6 2.5v4M14 2.5v4M3 9h14"/></svg></button><input class="compact-date-native" type="date" value="${esc(value)}" max="${C.today()}" tabindex="-1" aria-hidden="true"></div></div>`;
}
function validateDateInput(input){
 const value=input.value,valid=C.validDate(value)&&value<=C.today();
 input.setCustomValidity((value===''&&!input.required)||valid?'':t('买入日期无效或晚于今天。'));
 const picker=input.closest('.compact-date-control')?.querySelector('.compact-date-native');if(picker)picker.value=valid?value:'';
}
function openDatePicker(button){
 const control=button.closest('.compact-date-control'),text=control.querySelector('[data-date-text]'),picker=control.querySelector('.compact-date-native');
 picker.value=C.validDate(text.value)&&text.value<=C.today()?text.value:'';
 try{if(typeof picker.showPicker==='function'){picker.showPicker();return;}}catch{}
 text.focus();text.select();
}
function syncSteppers(form){
 if(!form)return;
 form.querySelectorAll('.number-control').forEach(control=>{
  const input=control.querySelector('input'),value=input.value.trim()===''?NaN:Number(input.value);
  control.querySelector('[data-step-direction="-1"]').disabled=input.disabled||(input.min!==''&&Number.isFinite(value)&&value<=Number(input.min));
  control.querySelector('[data-step-direction="1"]').disabled=input.disabled||(input.max!==''&&Number.isFinite(value)&&value>=Number(input.max));
 });
}
function stepNumberInput(input,direction){
 if(input.disabled||input.readOnly||![1,-1].includes(direction))return;
 const step=Number(input.dataset.stepSize),current=Number.isFinite(input.valueAsNumber)?input.valueAsNumber:0;
 if(![.01,1].includes(step))return;
 let value=step===1?(direction>0?Math.floor(current)+1:Math.ceil(current)-1):Math.round((current+direction*step)*1000)/1000;
 if(input.min!=='')value=Math.max(Number(input.min),value);
 if(input.max!=='')value=Math.min(Number(input.max),value);
 if(Number.isFinite(input.valueAsNumber)&&value===input.valueAsNumber)return;
 input.value=String(value);input.dataset.dirty='1';
 input.dispatchEvent(new Event('input',{bubbles:true}));
}
const num=(label,name,value,required=true)=>field(label,name,value,`type="number" min="0" step="any" inputmode="decimal" ${required?'required':''}`);
async function write(next){
 if(!ready)throw Error(t("本地数据库不可用。"));$('#save-status').textContent=t("保存中");
 await new Promise((resolve,reject)=>{const tx=db.transaction('ledger','readwrite'),store=tx.objectStore('ledger');let conflict=false;const r=store.get('main');r.onsuccess=()=>{if((r.result?.revision??0)!==revision){conflict=true;tx.abort();return;}store.put({revision:revision+1,state:next},'main');};tx.oncomplete=resolve;tx.onabort=()=>reject(Error(conflict?t("另一个页面已更新账本，请刷新本页。"):t("保存失败，原数据未改变。")));tx.onerror=()=>reject(Error(t("保存失败，请检查浏览器存储空间。")));});revision++;state=next;render();
}
async function mutate(fn,message){if(busy)return;busy=true;try{const next=structuredClone(state);await fn(next);await write(C.validate(next));modal.close();if(message)toast(message);}finally{busy=false;}}
function render(){
 I18n.setLanguage(state.view?.language??'en');
 document.documentElement.lang=I18n.language==='en'?'en':'zh-CN';
 document.title=t('我的持仓');
 $('.sidebar-heading h1').textContent=t('我的持仓');
 $('#language-button').textContent=t('语言 · 中文');
 $('.summary-sidebar [data-action="add-stock"]').textContent=t('＋ 新增股票');
 for(const [action,key] of [['settings','费率'],['export','导出'],['import','导入'],['clear','清除']])$('.summary-sidebar [data-action="'+action+'"]').textContent=t(key);
 $('#overview').setAttribute('aria-label',t('持仓汇总'));$('#stocks').setAttribute('aria-label',t('全部股票与机动仓'));
 document.documentElement.dataset.theme=state.view?.theme??'light';
 $('#theme-button').textContent=state.view?.theme==='dark'?t("主题 · 夜间"):t("主题 · 日间");
 $('#theme-button').setAttribute('aria-pressed',String(state.view?.theme==='dark'));
 document.documentElement.style.fontSize=`${state.view?.fontPercent??120}%`;
 let fontButton=$('#font-size-button');if(!fontButton&&$('.summary-sidebar')){$('.summary-sidebar').insertAdjacentHTML('beforeend',`<button class="font-size-button" id="font-size-button" data-action="font-size">${t("字体")}</button>`);fontButton=$('#font-size-button');}if(fontButton)fontButton.textContent=`${t("字体")} ${state.view?.fontPercent??120}%`;
 $('#save-status').textContent=ready?t("已保存"):t("存储不可用");
 const list=state.stocks.map(C.stats),missing=list.some(x=>x.value===null),sum=k=>C.round(list.reduce((n,s)=>n+(s[k]??0),0)),pnl=missing?null:sum('total'),value=missing?null:sum('value'),cost=C.round(list.reduce((n,s)=>n+s.cost,0)-state.stocks.reduce((n,s)=>n+s.realized,0)),pnlPct=pnl===null?null:cost>0?pnl/cost*100:null;
 $('#overview').innerHTML=`<div><div class="overview-heading"><span>${t("总持仓盈亏")}</span><b class="${color(pnl)}">${pnlPct===null?'—':signed(pnlPct)+'%'}</b></div><strong class="${color(pnl)}">${signed(pnl)}</strong></div><div><span>${t("总持仓市值（万）")}</span><strong title="CNY ${money(value)}">${marketWan(value)}</strong></div>`;
 $('#stocks').innerHTML=state.stocks.length?state.stocks.map(stockCard).join(''):`<div class="empty"><p>${t("还没有持仓")}</p><button class="primary" data-action="add-stock">${t("＋ 新增股票 / 录入已有持仓")}</button></div>`;
 $('.app-shell').classList.toggle('three-positions',state.stocks.length===3);
 tableResizeObserver?.disconnect();
 tableResizeObserver=new ResizeObserver(entries=>entries.forEach(({target})=>{const panel=target.closest('.mobile-panel');if(target.classList.contains('table-wrap')){const style=getComputedStyle(target),gap=`${Math.max(0,target.offsetWidth-target.clientWidth-parseFloat(style.borderLeftWidth)-parseFloat(style.borderRightWidth))}px`;target.previousElementSibling.style.marginRight=gap;target.nextElementSibling.style.marginRight=gap;fitNumericText(target.nextElementSibling);}if(panel){const header=panel.querySelector('.table-header'),footer=panel.querySelector('.table-footer');footer.style.setProperty('--table-footer-height',header.offsetHeight?`${header.offsetHeight}px`:'auto');}fitNumericText(target);}));
 document.querySelectorAll('.mobile-panel .table-wrap').forEach(wrap=>{const head=wrap.previousElementSibling,foot=wrap.nextElementSibling;wrap.addEventListener('scroll',()=>{head.scrollLeft=wrap.scrollLeft;foot.scrollLeft=wrap.scrollLeft;},{passive:true});tableResizeObserver.observe(head);tableResizeObserver.observe(wrap);tableResizeObserver.observe(wrap.querySelector('table'));});
 fitNumericText($('#stocks'));
}
function fitNumericText(container){
 container.querySelectorAll('.pnl-line,.value-line,.numeric-line').forEach(line=>{
  line.style.setProperty('--pnl-scale','1');
  const cell=line.closest('td'),style=getComputedStyle(cell),available=cell.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)-1,natural=line.getBoundingClientRect().width;
  if(available>0&&natural>available){const scale=available/natural;line.style.setProperty('--pnl-scale',String(scale));const actual=line.getBoundingClientRect().width;if(actual>available)line.style.setProperty('--pnl-scale',String(scale*available/actual*.995));}
  line.title=line.textContent;
 });
}
function stockCard(s){const columns=[8,10,10,14,10,13,17,18];const st=C.stats(s),totalPct=st.total===null||st.cost-s.realized<=0?null:st.total/(st.cost-s.realized)*100,mobile=C.sortedMobileLots(s),mobileQty=mobile.reduce((n,l)=>n+l.qty,0),mobileValue=mobileQty===0?0:s.price===null?null:C.round(mobileQty*s.price),mobilePnl=mobileValue===null?null:C.round(mobileValue-st.mobileCost),pct=mobilePnl===null?null:st.mobileCost?mobilePnl/st.mobileCost*100:0;
 return `<article class="stock stock-grid">
 <section class="base-panel"><div class="stock-name-line"><h2>${esc(s.name)}</h2><form class="inline-quote quote-badge" data-stock="${s.id}" style="--quote-ch:${s.price===null?3:String(C.round(s.price)).length}"><input class="stock-current-price" name="price" type="number" step="0.001" min="0.001" max="10000000" value="${s.price===null?'':C.round(s.price)}" data-raw-value="${s.price??''}" aria-label="${esc(s.name)} ${t('现价')}" enterkeyhint="done" required></form></div><dl class="position-metrics stock-position"><div class="position-pnl"><dt>${t("总盈亏")}</dt><dd class="${color(st.total)}" title="${t("总盈亏包含已结算盈亏，成本已抵扣已实现净收益")}">${signed(st.total)} / ${totalPct===null?'—':signed(totalPct)+'%'}</dd></div><div class="market-value"><dt>${t("市值")}</dt><dd title="CNY ${money(st.value)}">${marketWan(st.value)} <small class="market-unit">${st.value===null?'':t("万")}</small></dd></div><div class="position-emphasis"><dt>${t("持仓成本价")}</dt><dd>${priceText(st.qty?(st.cost-s.realized)/st.qty:null)}</dd></div><div class="position-emphasis"><dt>${t("总持仓 / 底仓")}</dt><dd>${money(st.qty,0)} / ${money(st.baseQty,0)} ${t("股")}</dd></div></dl><div class="mobile-capacity">${s.mobileTargetQty?t("机动仓预设 {target} 股 · {status} {remaining} 股",{target:money(s.mobileTargetQty,0),status:t(mobileQty>s.mobileTargetQty?"超出":"剩余"),remaining:`<strong>${money(Math.abs(s.mobileTargetQty-mobileQty),0)}</strong>`}):t("机动仓预设：未设置")}</div></section>
 <section class="mobile-panel"><div class="table-header"><div class="table-header-grid" role="row"><span role="columnheader">${t("股数")}</span><span role="columnheader">${t("买入价")}</span><span role="columnheader">${t("持有天数")}</span><span role="columnheader">${t("盈亏")}</span><span role="columnheader">${t("盈亏率")}</span><span role="columnheader" title="${t("市值（元）")}">${t("市值/元")}</span><span role="columnheader">${t("买入时间")}</span><span role="columnheader">${t("操作")}</span></div></div><div class="table-wrap" tabindex="0" aria-label="${t("机动仓记录")}"><table aria-label="${t("机动仓明细")}"><colgroup>${columns.map(width=>`<col style="width:${width}%">`).join('')}</colgroup><tbody>${mobile.length?mobile.map(l=>lotRow(s,l)).join(''):`<tr><td colspan="8" class="no-lots">${t("暂无机动仓")}</td></tr>`}</tbody></table></div><div class="table-footer" role="region" aria-label="${t('合计')}"><table aria-label="${t('合计')}"><colgroup>${columns.map(width=>`<col style="width:${width}%">`).join('')}</colgroup>${mobileFooter(s)}</table></div></section>
 <section class="operation-panel"><button class="primary" data-action="buy" data-id="${s.id}">${t("＋ 机动仓")}</button><div class="secondary-actions"><button class="primary" data-action="edit-stock" data-id="${s.id}">${t("修改股票")}</button></div><div class="stock-order"><button data-action="move-up" data-id="${s.id}" ${state.stocks[0]?.id===s.id?'disabled':''}>↑ ${t("上移")}</button><button data-action="move-down" data-id="${s.id}" ${state.stocks.at(-1)?.id===s.id?'disabled':''}>↓ ${t("下移")}</button></div><button class="primary history-button" data-action="history" data-id="${s.id}" aria-haspopup="dialog">${t("交易历史")}</button></section></article>`;
}
function lotRow(s,l){const age=C.days(l.date),value=s.price===null?null:C.round(s.price*l.qty),pnl=value===null?null:C.round(value-l.cost),pct=pnl===null||!l.cost?null:pnl/l.cost*100;
 return `<tr><td class="numeric-cell" data-label="${t("股数")}"><span class="numeric-line">${money(l.qty,0)}</span></td><td data-label="${t("买入价")}" title="${t("买入费用")} ${money(l.fee)}"><span class="numeric-line">${priceText(l.price)}</span></td><td class="age-cell" data-label="${t("持有天数")}" title="${l.date||t("买入日期未录入")}"><span>${age===null?t("未知"):`${age}${t("天")}`}</span></td><td data-label="${t("浮动盈亏")}" class="pnl-cell ${color(pnl)}"><span class="pnl-line">${signed(pnl)}</span></td><td data-label="${t("盈亏率")}" class="pnl-cell ${color(pnl)}"><span class="pnl-line">${pct===null?'—':`${signed(pct)}%`}</span></td><td class="value-cell" data-label="${t("市值（元）")}" title="CNY ${money(value)}"><span class="value-line">${money(value)}</span></td><td class="purchase-date" data-label="${t("买入时间")}">${l.date?esc(l.date):t("未知")}</td><td class="row-actions"><div class="lot-actions"><button data-action="settle" data-id="${s.id}" data-lot="${l.id}">${t("卖出")}</button><button data-action="edit-lot" data-id="${s.id}" data-lot="${l.id}">${t("更正")}</button></div></td></tr>`;
}
function mobileFooter(s){const st=C.mobileSummary(s);return `<tfoot><tr class="mobile-summary"><td data-label="${t('总股数')}"><span class="numeric-line">${money(st.qty,0)}</span></td><td data-label="${t('平均买入价')}"><span class="numeric-line">${priceText(st.avgPrice)}</span></td><td data-label="${t('平均持有天数')}"><span class="numeric-line">${st.avgDays===null?'—':money(st.avgDays)+t('天')}</span></td><td data-label="${t('总盈亏')}" class="${color(st.pnl)}"><span class="numeric-line">${signed(st.pnl)}</span></td><td data-label="${t('总盈亏率')}" class="${color(st.pnl)}"><span class="numeric-line">${st.pct===null?'—':signed(st.pct)+'%'}</span></td><td data-label="${t('总市值')}"><span class="numeric-line">${money(st.value)}</span></td><td class="summary-label">${t('合计')}</td><td class="row-actions"><button data-action="sell-all" data-id="${s.id}" ${st.qty?'':'disabled'}>${t('全部卖出')}</button></td></tr></tfoot>`;}
function saleDateField(){return field(t('卖出日期'),'sale-date',C.today(),`type="date" max="${C.today()}" required`);}
function historyDialog(id,page=0){
 const s=getStock(state,id),summary=C.historySummary(s),pageSize=6;
 openDialog(esc(s.name),t('交易历史'),`<dl class="history-summary">${[{label:'累计净盈亏',pnl:summary.total},...summary.periods.map(p=>({...p,label:p.months===1?'近1个月':p.months===6?'近半年':'近一年'}))].map(p=>`<div><dt>${t(p.label)}</dt><dd class="${color(p.pnl)}">${signed(p.pnl)}</dd></div>`).join('')}</dl><div class="history-table-wrap" aria-label="${t('交易历史')}"><table class="history-table" role="table"><thead role="rowgroup"><tr role="row">${['日期','买卖','股数','成交价','费用/元','净盈亏/元','操作'].map(key=>`<th role="columnheader" scope="col">${t(key)}</th>`).join('')}</tr></thead><tbody id="history-rows" role="rowgroup"></tbody></table></div><div class="history-pagination"><button type="button" id="history-prev">${t('上一页')}</button><span id="history-page" role="status"></span><button type="button" id="history-next">${t('下一页')}</button></div>`,t('关闭'),()=>modal.close(),'',true);
 $('#dialog-form .modal-foot').remove();
 $('#form-error').remove();
 const draw=()=>{
  const entries=s.history.entries.map((entry,index)=>({entry,index})).sort((a,b)=>b.entry.date.localeCompare(a.entry.date)||b.index-a.index).map(({entry})=>entry);
  const pages=Math.max(1,Math.ceil(entries.length/pageSize));page=Math.max(0,Math.min(page,pages-1));
  const pageEntries=entries.slice(page*pageSize,(page+1)*pageSize);
  const rows=pageEntries.map(e=>historyRow(s,e,page)).join('')||`<tr class="history-empty-row" role="row"><td role="cell" colspan="7" class="history-empty">${t('暂无交易')}</td></tr>`;
  const blankRows=Array.from({length:pageSize-Math.max(1,pageEntries.length)},()=>`<tr class="history-placeholder" aria-hidden="true">${'<td></td>'.repeat(7)}</tr>`).join('');
  $('#history-rows').innerHTML=rows+blankRows;
  $('#history-prev').disabled=page===0;$('#history-next').disabled=page>=pages-1;
  $('.history-pagination').hidden=pages===1;
  $('#history-page').textContent=t('第 {page} / {pages} 页 · {count} 条',{page:page+1,pages,count:entries.length});
 };
 $('#history-prev').onclick=()=>{page--;draw();};$('#history-next').onclick=()=>{page++;draw();};draw();
}
function historyRow(s,e,page=0){
 const reason=C.undoReason(s,e.id);
 return `<tr role="row"><td role="cell">${e.date}</td><td role="cell" class="${e.type==='buy'?'history-buy':'history-sell'}">${t(e.type==='buy'?'买入':'卖出')}</td><td role="cell">${money(e.qty,0)}</td><td role="cell">${priceText(e.price)}</td><td role="cell">${money(e.fee)}</td><td role="cell" class="${color(e.pnl)}">${e.pnl===null?'—':signed(e.pnl)}</td><td role="cell"><button type="button" class="history-undo" data-action="undo-trade" data-id="${s.id}" data-trade="${e.id}" data-page="${page}" ${reason?`disabled title="${esc(t(reason))}"`:''}>${t('撤销')}</button></td></tr>`;
}
function costImpactHtml(before,after){const impact=C.settlementImpact(before,after),amount=n=>Number(n).toLocaleString('zh-CN',{maximumFractionDigits:6}),change=impact.reduction;return `<div class="cost-impact"><span>${t('持仓成本价变化')}</span>${impact.afterPrice===null?`<strong>${t('已清仓，不再计算持仓成本价')}</strong>`:`<strong>${priceText(impact.beforePrice)} → ${priceText(impact.afterPrice)}</strong><span class="cost-impact-change">${Math.abs(change)<1e-9?t('持仓成本价不变'):t(change>0?'每股降低 {amount} 元':'每股升高 {amount} 元',{amount:amount(Math.abs(change))})}</span>`}</div>`;}
function settleAllDialog(id){const s=getStock(state,id);openDialog(t('全部卖出机动仓'),esc(s.name),`${field(t('卖出价'),'price',s.price??0,'type="number" min="0.001" step="0.001" required inputmode="decimal"')}${saleDateField()}<div id="sell-all-estimate" class="settle-preview"></div>`,t('确认全部卖出'),async f=>mutate(next=>{const item=getStock(next,id),price=+f.get('price');C.settleMobileAll(item,price,next.settings,f.get('sale-date'));C.quote(item,price,f.get('sale-date'));},t('已结算')));const update=()=>{try{const after=structuredClone(s),result=C.settleMobileAll(after,+readForm($('#dialog-form')).get('price'),state.settings,readForm($('#dialog-form')).get('sale-date'));$('#sell-all-estimate').innerHTML=`<span>${t('净盈亏')} <b class="${color(result.pnl)}">${signed(result.pnl)}</b></span>${costImpactHtml(s,after)}<span>${t('卖出费用')} ${money(result.fees)} · ${t('回收')} ${money(result.net)}</span>`;}catch(e){$('#sell-all-estimate').textContent=I18n.error(e.message);}};$('#dialog-form').addEventListener('input',update);update();}
function stockDialog(){
 openDialog(t("新增股票"),'',`<div class="form-grid">${field(t("股票名称"),'name','',`required maxlength="40" placeholder="${t("例如：中国人寿")}"`)}${field(t("现价"),'price',0,'type="number" min="0.001" step="0.001" required inputmode="decimal"')}${field(t("成本价"),'base-price',0,'type="number" min="0.001" step="0.001" required inputmode="decimal"')}${field(t("底仓手数"),'base-hands',1,'type="number" min="1" step="1" required inputmode="numeric"')}${targetField(0)}</div><div id="base-estimate" class="calculation"></div>`,t("添加"),async f=>mutate(next=>{const name=f.get('name');if(next.stocks.some(s=>s.name.trim().toLowerCase()===name.trim().toLowerCase()))throw Error(t("这只股票已存在。"));next.stocks.push(C.createPosition({name,price:+f.get('price'),basePrice:+f.get('base-price'),baseQty:C.handsToShares(+f.get('base-hands')),mobileAmount:0,mobileTargetQty:C.handsToShares(+f.get('mobile-target-hands'),{allowZero:true})},next.settings));},t("已添加")));
 const form=$('#dialog-form'),update=()=>{const f=readForm(form),p=+f.get('base-price'),q=Math.round(+f.get('base-hands')*100);if(p>0&&q>0){const gross=C.round(p*q),fees=0;$('#base-estimate').innerHTML=`<span>${t("底仓金额")} <b>${money(C.round(gross+fees))}</b></span><span>${t("费用")} <b>${money(fees)}</b></span>`;}else $('#base-estimate').textContent='';};
 form.addEventListener('input',e=>{if(e.target.name==='base-price')e.target.dataset.manual='1';if(e.target.name==='price'&&!form.elements['base-price'].dataset.manual)form.elements['base-price'].value=e.target.value;update();});update();
}
function buyDialog(id,tag='mobile',lotId){const s=getStock(state,id),existing=s.lots.find(l=>l.id===lotId);tag=existing?.tag||tag;const opening=existing?.source==='opening';
 openDialog(esc(s.name),existing?(tag==='base'?t("修改股票"):t("更正机动仓")):tag==='base'?t('新增底仓'):t('新增机动仓'),`<div class="form-grid">${field(t(opening?"成本价":"买入价"),'price',existing?.price??s.price??0,'type="number" min="0.001" step="0.001" required inputmode="decimal"')}${field(t("买入手数"),'hands',existing?existing.qty/100:1,'type="number" min="1" step="1" required inputmode="numeric"')}</div>${existing&&tag==='base'?targetField(s.mobileTargetQty):''}${buyDateField(existing?existing.date??'':C.today(),!opening)}<div id="buy-estimate" class="calculation buy-calculation"></div>`,existing?t("保存修改"):t("添加"),async f=>{
  const args={price:+f.get('price'),qty:C.handsToShares(+f.get('hands')),tag,date:f.get('date')||null,...(opening?{feeMode:'included'}:{})};
  const record=async allowTopUp=>mutate(next=>{const item=getStock(next,id);if(existing){C.correctLot(item,existing.id,args,next.settings);if(tag==='base')item.mobileTargetQty=C.handsToShares(+f.get('mobile-target-hands'),{allowZero:true});}else{C.addLot(item,args,next.settings,{allowTopUp});if(tag==='mobile')C.quote(item,args.price);}},t("已保存"));
  const fees=C.fee(C.round(args.price*args.qty),'buy',s.kind,state.settings),needed=C.round(args.price*args.qty+fees),shortfall=C.round(needed-getStock(state,id).cash.mobile);
  const exhausted=!existing&&tag==='mobile'&&shortfall>0;
  await record(exhausted);
  if(exhausted&&s.budget.mobile>0)toast(t("机动仓金额已耗尽，已记录本笔买入。"));
 },existing&&tag==='base'?deleteStockButton(id):existing?`<button class="danger-text push-left" type="button" data-action="remove-lot" data-id="${id}" data-lot="${lotId}">${t("删除误录")}</button>`:'');
 const update=()=>{const f=readForm($('#dialog-form')),price=+f.get('price'),qty=Math.round(+f.get('hands')*100);if(price>0&&qty>0){const same=existing&&price===existing.price&&qty===existing.qty,fee=opening?0:same?existing.fee:C.fee(C.round(price*qty),'buy',s.kind,state.settings);$('#buy-estimate').innerHTML=`<span class="calculation-item"><span>${t("股数")}</span><b>${money(qty,0)}</b></span><span class="calculation-item"><span>${t("费用")}</span><b>${money(fee)}</b></span><span class="calculation-item"><span>${t("总花费")}</span><b>${money(C.round(price*qty+fee))}</b></span>`;}else $('#buy-estimate').textContent='';};$('#dialog-form').addEventListener('input',update);update();
}
function targetField(value){return field(t('预设机动仓手数'),'mobile-target-hands',(value??0)/100,'type="number" min="0" max="10000000" step="1" required inputmode="numeric"');}
function deleteStockButton(id){return `<button class="delete-stock-button" type="button" data-action="delete-stock" data-id="${id}">${t("删除股票")}</button>`;}
function baseDialog(id){const s=getStock(state,id),base=s.lots.filter(l=>l.tag==='base');
 if(base.length===1){buyDialog(id,'base',base[0].id);return;}
 openDialog(esc(s.name),t("修改股票"),` ${targetField(s.mobileTargetQty)}<div class="base-list">${base.map(l=>`<div><span>${t("买入价")} <b>${priceText(l.price)}</b> · <b>${money(l.qty,0)}</b> ${t("股")}</span><button type="button" data-action="edit-lot" data-id="${id}" data-lot="${l.id}">${t("修改")}</button></div>`).join('')||t("暂无底仓")}</div>`,t("保存修改"),async f=>mutate(next=>{getStock(next,id).mobileTargetQty=C.handsToShares(+f.get("mobile-target-hands"),{allowZero:true});},t("已保存")),deleteStockButton(id));
}
function settleDialog(id,lotId){const s=getStock(state,id),l=s.lots.find(l=>l.id===lotId);if(!l)throw Error(t("持仓已不存在。"));
 openDialog(t("卖出结算"),`${esc(s.name)} · ${t("当前 {qty} 股",{qty:money(l.qty,0)})}`,`<div class="form-grid">${field(t("卖出价"),'price',s.price??l.price,'type="number" min="0.001" step="0.001" required inputmode="decimal"')}${field(t("卖出手数"),'hands',l.qty/100,`type="number" min="1" max="${Math.floor(l.qty/100)}" step="1" required inputmode="numeric"`)}</div>${saleDateField()}<div id="sell-estimate" class="settle-preview"></div>`,t("确认卖出"),async f=>mutate(next=>{const item=getStock(next,id),price=+f.get('price');C.settle(item,lotId,price,next.settings,C.handsToShares(+f.get('hands')),f.get('sale-date'));C.quote(item,price,f.get('sale-date'));},t("已结算")));
 const update=()=>{const f=readForm($('#dialog-form')),p=+f.get('price');try{const q=C.handsToShares(+f.get('hands')),after=structuredClone(s),preview=C.settle(after,lotId,p,state.settings,q,f.get('sale-date'));$('#sell-estimate').innerHTML=`<span>${t("净盈亏")} <b class="${color(preview.pnl)}">${signed(preview.pnl)}</b></span>${costImpactHtml(s,after)}<span>${t("卖出费用")} ${money(preview.fees)} · ${t("回收")} ${money(preview.net)}</span>`;}catch(e){$('#sell-estimate').textContent=I18n.error(e.message);}};$('#dialog-form').addEventListener('input',update);update();
}
function fontDialog(){
 const current=state.view?.fontPercent??120;
 openDialog(t("调整字体"),'',`${field(t("字体大小（%）"),'font-percent',current,'type="number" min="80" max="160" step="1" required inputmode="numeric"')}<input id="font-slider" type="range" min="80" max="160" step="1" value="${current}" aria-label="${t("字体百分比")}"><div class="font-presets">${[100,120,150].map(n=>`<button type="button" data-font="${n}">${n}%</button>`).join('')}</div>`,t("保存"),async f=>mutate(next=>{const n=+f.get('font-percent');if(!Number.isInteger(n)||n<80||n>160)throw Error(t("请输入80至160之间的整数。"));next.view={...next.view,fontPercent:n};},t("字号已保存")));
 const form=$('#dialog-form'),apply=n=>{if(!Number.isInteger(n)||n<80||n>160)return;form.elements['font-percent'].value=n;$('#font-slider').value=n;document.documentElement.style.fontSize=`${n}%`;fitNumericText($('#stocks'));form.querySelectorAll('[data-font]').forEach(b=>b.classList.toggle('selected',+b.dataset.font===n));};
 form.addEventListener('input',e=>{if(e.target.name==='font-percent'||e.target.id==='font-slider')apply(+e.target.value);});form.addEventListener('click',e=>{const b=e.target.closest('[data-font]');if(b)apply(+b.dataset.font);});apply(current);
}

function settingsDialog(){const s=state.settings;openDialog(t("交易费率"),'',`<div class="form-grid">${num(t("股票佣金 · 万分之"),'commission',s.commission*10000)}${num(t("最低收费 · 元"),'minimum',s.minimum)}${num(t("ETF佣金 · 万分之"),'etfCommission',s.etfCommission*10000)}${num(t("ETF最低收费 · 元"),'etfMinimum',s.etfMinimum)}${num(t("卖出印花税 · 万分之"),'stamp',s.stamp*10000)}${num(t("双向过户费 · 万分之"),'transfer',s.transfer*10000)}</div>`,t("保存"),async f=>mutate(next=>{for(const k of Object.keys(C.defaults()))next.settings[k]=+f.get(k)/(k.toLowerCase().includes('minimum')?1:10000);},t("费率已保存")));}
function confirmDialog(title,body,button,handler){openDialog(title,'',`<p class="confirm-copy">${body}</p>`,button,handler);}
async function exportData(){if(busy)return;busy=true;try{const backup=structuredClone(state);backup.lastBackup=new Date().toISOString();const blob=new Blob([JSON.stringify({app:'持仓手记',...backup},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${t("持仓手记")}-${C.today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);await write(backup);toast(t("备份已导出"));}finally{busy=false;}}
function showImport(data){const n=data.stocks.reduce((n,s)=>n+s.lots.length,0);confirmDialog(t("导入备份"),t("恢复 {stocks} 只股票、{lots} 笔持仓，覆盖当前账本。",{stocks:data.stocks.length,lots:n}),t("覆盖并恢复"),async()=>mutate(next=>{Object.keys(next).forEach(k=>delete next[k]);Object.assign(next,data);},t("已恢复")));}
async function action(name,el){const id=el.dataset.id,l=el.dataset.lot;if(name==='close'){modal.close();return;}if(!ready){toast(t("本地存储不可用"));return;}
 switch(name){case'history':historyDialog(id);break;case'undo-trade':await mutate(next=>C.undoTrade(getStock(next,id),el.dataset.trade),t('已撤销'));historyDialog(id,+el.dataset.page||0);break;case'sell-all':settleAllDialog(id);break;case'move-up':case'move-down':await mutate(next=>{const index=next.stocks.findIndex(s=>s.id===id),to=index+(name==='move-up'?-1:1);if(index<0||to<0||to>=next.stocks.length)return;[next.stocks[index],next.stocks[to]]=[next.stocks[to],next.stocks[index]];});break;case'add-stock':stockDialog();break;case'edit-stock':baseDialog(id);break;case'buy':buyDialog(id);break;case'base':baseDialog(id);break;case'edit-lot':buyDialog(id,'mobile',l);break;case'settle':settleDialog(id,l);break;case'settings':settingsDialog();break;case'font-size':fontDialog();break;case'language':await mutate(next=>{next.view={...next.view,language:next.view?.language==='en'?'zh':'en'};});$('#toast').classList.remove('show');clearTimeout(toast.timer);break;case'theme':await mutate(next=>{next.view={...next.view,theme:next.view?.theme==='dark'?'light':'dark'};});break;case'export':await exportData();break;case'import':$('#import-file').click();break;
 case'clear':confirmDialog(t("清除全部数据"),t("删除当前账本，只能从已导出的备份恢复。"),t("确认清除"),async()=>mutate(next=>{Object.keys(next).forEach(k=>delete next[k]);Object.assign(next,C.empty());},t("已清空")));break;
 case'delete-stock':confirmDialog(t("删除股票"),t("删除 {name} 的全部持仓和资金记录。",{name:esc(getStock(state,id).name)}),t("确认删除"),async()=>mutate(next=>{next.stocks=next.stocks.filter(s=>s.id!==id);},t("已删除")));break;
 case'remove-lot':confirmDialog(t("删除误录"),getStock(state,id).lots.find(x=>x.id===l)?.source==='opening'?t("移除这笔初始持仓，不改变现金，不产生结算盈亏。"):t("仅用于误录：资金退回，不产生盈亏。真实卖出请点“卖出”。"),t("删除误录"),async()=>mutate(next=>C.removeLot(getStock(next,id),l),t("已删除误录")));break;}
}
 document.addEventListener('click',e=>{const button=e.target.closest('[data-date-picker]');if(button&&!busy)openDatePicker(button);});
 document.addEventListener('input',e=>{if(e.target.matches('[data-date-text]'))validateDateInput(e.target);});
 document.addEventListener('change',e=>{
  if(!e.target.matches('.compact-date-native'))return;
  const input=e.target.closest('.compact-date-control').querySelector('[data-date-text]');
  input.value=e.target.value;input.dispatchEvent(new Event('input',{bubbles:true}));
 });
 document.addEventListener('click',e=>{
  const button=e.target.closest('[data-step-direction]');if(!button||button.disabled||busy)return;
  stepNumberInput(button.closest('.number-control').querySelector('input'),Number(button.dataset.stepDirection));
 });
 document.addEventListener('input',e=>{if(e.target.matches('input[data-step-size]'))syncSteppers(e.target.form);});
 document.addEventListener('focusin',e=>{if(!e.target.matches('.quote-badge input'))return;const input=e.target;if(!input.dataset.dirty&&input.dataset.rawValue)input.value=input.dataset.rawValue;input.form.style.setProperty('--quote-ch',String(Math.max(3,input.value.length)));});
 document.addEventListener('focusout',e=>{if(!e.target.matches('.quote-badge input'))return;const input=e.target;if(!input.dataset.dirty&&input.dataset.rawValue)input.value=String(C.round(+input.dataset.rawValue));input.form.style.setProperty('--quote-ch',String(Math.max(3,input.value.length)));});
 document.addEventListener('input',e=>{if(e.target instanceof HTMLInputElement){e.target.dataset.dirty='1';if(e.target.matches('.quote-badge input'))e.target.form.style.setProperty('--quote-ch',String(Math.max(3,e.target.value.length)));}},true);
 document.addEventListener('click',async e=>{const el=e.target.closest('[data-action]');if(!el||busy)return;try{await action(el.dataset.action,el);}catch(err){toast(I18n.error(err.message));}});
 document.addEventListener('submit',async e=>{if(!e.target.matches('.inline-quote'))return;e.preventDefault();if(busy)return;try{const form=e.target;await mutate(next=>C.quote(getStock(next,form.dataset.stock),+readForm(form).get('price')),t("价格已更新"));}catch(err){toast(I18n.error(err.message));}});
 $('#import-file').addEventListener('change',async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{if(file.size>15*1024*1024)throw Error(t("文件超过15MB"));showImport(C.validate(JSON.parse(await file.text())));}catch(err){toast(t("未导入：{error}",{error:I18n.error(err.message)}));}});
 modal.addEventListener('close',()=>{document.documentElement.style.fontSize=`${state.view?.fontPercent??120}%`;fitNumericText($('#stocks'));});
 modal.addEventListener('click',e=>{if(e.target===modal){const r=modal.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)modal.close();}});
 async function init(){try{db=await new Promise((resolve,reject)=>{const r=indexedDB.open('position-journal',1);r.onupgradeneeded=()=>r.result.createObjectStore('ledger');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error(t("请关闭旧版页面再打开")));});const row=await new Promise((resolve,reject)=>{const r=db.transaction('ledger').objectStore('ledger').get('main');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});if(row){state=C.validate(row.state);revision=row.revision;}ready=true;if(row&&row.state.version<4){await new Promise((resolve,reject)=>{const tx=db.transaction('ledger','readwrite');tx.objectStore('ledger').put(row,'before-v4');tx.oncomplete=resolve;tx.onerror=()=>reject(Error(t("旧版备份保存失败")));});await write(state);}else render();navigator.storage?.persist?.().catch(()=>{});}catch(err){render();toast(t("读取失败：{error}。请勿清理浏览器数据。",{error:I18n.error(err.message)}));}}
 render();init();
