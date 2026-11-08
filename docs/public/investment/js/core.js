(function(root){
'use strict';
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const uid=()=>globalThis.crypto?.randomUUID?.()||`id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const days=(date,until=today())=>date===null?null:Math.max(0,Math.floor((Date.parse(until)-Date.parse(date))/86400000));
const defaults=()=>({commission:.00009,minimum:0,stamp:.0005,transfer:.00001,etfCommission:.00005000001,etfMinimum:0});
const empty=()=>({version:4,settings:defaults(),view:{fontPercent:120,theme:'light',language:'en'},stocks:[],lastBackup:null});
const finite=(n,min=-1e12,max=1e12)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const groupOf=tag=>tag==='base'?'base':'mobile';
function fee(amount,side,kind,s){return round(round(Math.max(kind==='etf'?s.etfMinimum:s.minimum,amount*(kind==='etf'?s.etfCommission:s.commission)))+(kind==='etf'?0:round(amount*s.transfer))+(kind==='etf'||side==='buy'?0:round(amount*s.stamp)));}
const inferKind=name=>/ETF|LOF|基金|标普\s*500|纳指/i.test(name)?'etf':'stock';
function handsToShares(hands,{allowZero=false}={}){
 if(!finite(hands,allowZero?0:1,1e7)||!Number.isSafeInteger(hands))throw Error('请输入整数手数，每手100股。');return hands*100;
}
function holdingTotals(stocks){
 let profit=0,loss=0;for(const s of stocks){if(s.price===null&&s.lots.length)return{profit:null,loss:null};for(const l of s.lots){const p=round(s.price*l.qty-l.cost);if(p>0)profit+=p;else loss+=p;}}return{profit:round(profit),loss:round(loss)};
}

function makeStock({name,code='',kind,base,mobile,reserve,mobileTargetQty=0}){
 kind=kind||inferKind(name);
 if(typeof name!=='string'||!name.trim()||!(code===''||typeof code==='string'&&/^\d{6}$/.test(code))||!['stock','etf'].includes(kind))throw Error('请填写有效的股票名称。');
 if(![base,mobile,reserve].every(n=>finite(n,0,1e9))||base+mobile+reserve<=0)throw Error('请填写有效的资金配置。');
 if(!Number.isSafeInteger(mobileTargetQty)||mobileTargetQty<0||mobileTargetQty>1e9)throw Error('请输入有效的机动仓预设股数。');
 const budget={base:round(base),mobile:round(mobile),reserve:round(reserve)};
 return {id:uid(),name:name.trim().slice(0,40),code,kind,mobileTargetQty,budget,cash:{...budget},capital:round(base+mobile+reserve),price:null,priceDate:null,quotes:[],realized:0,lots:[],history:{openingRealized:0,entries:[]}};
}
function lot({price,qty,tag='mobile',date=today(),source='buy',feeMode=source==='opening'?'included':'auto',id=uid()},settings,kind){
 if(!finite(price,.000001,1e7)||!Number.isSafeInteger(qty)||qty<=0||qty>1e9||price*qty>1e12)throw Error('请输入有效的成本价格和整数股数。');
 if(!['base','mobile'].includes(tag))throw Error('请选择底仓或机动仓。');
 if(!['buy','opening'].includes(source))throw Error('持仓类型无效。');
 if(date!==null&&(!validDate(date)||date>today()))throw Error('买入日期无效或晚于今天。');
 if(source==='buy'&&date===null)throw Error('新买入需要买入日期。');
 if(!['included','auto'].includes(feeMode)||source==='buy'&&feeMode!=='auto')throw Error('费用口径无效。');
 const gross=round(price*qty),fees=feeMode==='included'?0:fee(gross,'buy',kind,settings);
 return {id,tag,price,qty,date,source,feeMode,fee:fees,cost:round(gross+fees)};
}
function quote(s,price,date=today()){
 if(!finite(price,.000001,1e7)||!validDate(date)||date>today())throw Error('请输入有效的报价。');
 s.quotes=s.quotes.filter(q=>q.date!==date);s.quotes.push({date,price});s.quotes.sort((a,b)=>a.date.localeCompare(b.date));s.price=s.quotes.at(-1).price;s.priceDate=s.quotes.at(-1).date;
}
function addLot(s,args,settings,{allowTopUp=false}={}){const l=lot(args,settings,s.kind),group=groupOf(l.tag),capitalBefore=s.capital;
 if(allowTopUp&&group==='mobile'&&l.cost>s.cash.mobile){const added=round(l.cost-s.cash.mobile);s.cash.mobile=round(s.cash.mobile+added);s.capital=round(s.capital+added);}
 if(l.cost>s.cash[group]+.001)throw Error(`${group==='base'?'底仓':'机动'}可用现金不足（需要 ${l.cost.toFixed(2)} 元，可用 ${s.cash[group].toFixed(2)} 元）。`);
 s.cash[group]=round(s.cash[group]-l.cost);s.lots.push(l);recordBuy(s,l,round(s.capital-capitalBefore));if(s.price===null)quote(s,l.price,l.date||today());return l;
}
function initialize(s,entries,cash,price,settings){
 if(s.lots.length||s.realized)throw Error('已有记录的股票不能重复初始化。');if(!entries.length)throw Error('请至少录入一笔已有持仓，或选择新建空仓。');
 const lots=entries.map(e=>lot({...e,date:e.date||null,source:'opening'},settings,s.kind));
 for(const k of ['base','mobile','reserve'])if(!finite(cash[k],0,1e9))throw Error('请填写实际剩余现金，满仓时可填0。');
 s.lots=lots;s.cash={base:round(cash.base),mobile:round(cash.mobile),reserve:round(cash.reserve)};s.capital=round(lots.reduce((n,l)=>n+l.cost,0)+s.cash.base+s.cash.mobile+s.cash.reserve);if(price!==null)quote(s,price);return s;
}
function createPosition({name,price,basePrice,baseQty,mobileAmount,mobileTargetQty=0},settings){
 if(!finite(price,.000001,1e7))throw Error('请填写大于0的现价。');
 const initial=lot({price:basePrice,qty:baseQty,tag:'base',source:'opening',feeMode:'included',date:today()},settings,inferKind(name));
 mobileAmount=mobileAmount??initial.cost;if(!finite(mobileAmount,0,1e9))throw Error('机动资金必须是有效的非负金额。');mobileAmount=round(mobileAmount);
 const s=makeStock({name,base:initial.cost,mobile:mobileAmount,reserve:0,mobileTargetQty});
 initialize(s,[{price:basePrice,qty:baseQty,tag:'base',feeMode:'included',date:today()}],{base:0,mobile:mobileAmount,reserve:0},price,settings);return s;
}

function settle(s,id,price,settings,qty,date=today()){
 const l=s.lots.find(l=>l.id===id);if(!l)throw Error('这笔持仓已不存在。');if(!finite(price,.000001,1e7))throw Error('请输入有效卖出价格。');
 qty=qty??l.qty;if(!Number.isSafeInteger(qty)||qty<=0||qty>l.qty)throw Error('卖出股数不能超过这笔剩余持仓。');
 checkSaleDate([l],date);const before=[snapshotLot(s,l)];
 const remain=l.qty-qty,remainingFee=remain?round(l.fee*remain/l.qty):0,remainingCost=remain?round(l.price*remain+remainingFee):0,soldCost=round(l.cost-remainingCost);
 const gross=round(price*qty),fees=fee(gross,'sell',s.kind,settings),net=round(gross-fees),pnl=round(net-soldCost),group=groupOf(l.tag);
 if(s.cash[group]+net<0)throw Error('卖出费用大于可用金额，请检查费率。');s.cash[group]=round(s.cash[group]+net);s.realized=round(s.realized+pnl);
 const legs=[{...historyLeg(l),qty,fee:round(l.fee-remainingFee),cost:soldCost}];
 if(remain){l.qty=remain;l.fee=remainingFee;l.cost=remainingCost;}else s.lots=s.lots.filter(x=>x.id!==id);
 recordSale(s,{date,price,qty,fee:fees,cost:soldCost,pnl,legs},before);return {net,pnl,fees,remaining:remain};
}
function removeLot(s,id){const l=s.lots.find(x=>x.id===id);if(!l)throw Error('记录已不存在。');if(l.tag==='mobile'&&!s.history.entries.some(e=>e.type==='sell'&&e.legs.some(x=>x.lotId===id)))s.history.entries=s.history.entries.filter(e=>!e.legs.some(x=>x.lotId===id));if(l.source==='opening')s.capital=round(s.capital-l.cost);else s.cash[groupOf(l.tag)]=round(s.cash[groupOf(l.tag)]+l.cost);s.lots=s.lots.filter(x=>x.id!==id);}
function correctLot(s,id,args,settings){
 const old=s.lots.find(l=>l.id===id);if(!old)throw Error('记录已不存在。');const next=lot({...args,id,source:old.source,feeMode:old.source==='opening'?(args.feeMode||old.feeMode||'included'):'auto'},settings,s.kind);
 if(old.price===next.price&&old.qty===next.qty&&old.feeMode===next.feeMode){next.fee=old.fee;next.cost=old.cost;}
 if(['price','qty','feeMode','fee','cost','tag','date'].every(key=>old[key]===next[key]))return old;
 if(old.source==='opening'){s.capital=round(s.capital+next.cost-old.cost);s.lots=s.lots.map(l=>l.id===id?next:l);syncBuyCorrection(s,next,0);return next;}
 const a=groupOf(old.tag),b=groupOf(next.tag),cash={...s.cash};cash[a]=round(cash[a]+old.cost);cash[b]=round(cash[b]-next.cost);
 const added=b==='mobile'?Math.max(0,round(-cash[b])):0;cash[b]=round(cash[b]+added);
 if(cash[b]<0)throw Error('更正后的成本超过可用资金，请先调整资金配置。');s.capital=round(s.capital+added);s.cash=cash;s.lots=s.lots.map(l=>l.id===id?next:l);syncBuyCorrection(s,next,added);return next;
}
function configure(s,budget,cash,name){
 if(!name.trim())throw Error('名称不能为空。');for(const k of ['base','mobile','reserve'])if(!finite(budget[k],0,1e9)||!finite(cash[k],0,1e9))throw Error('金额必须是有效的非负数。');
 const before=s.cash.base+s.cash.mobile+s.cash.reserve,after=cash.base+cash.mobile+cash.reserve;s.capital=round(s.capital+after-before);s.budget={...budget};s.cash={...cash};s.name=name.trim().slice(0,40);if(!s.code)s.kind=inferKind(s.name);
}
function sortedMobileLots(s){
 return s.lots.map((lot,index)=>({lot,index})).filter(({lot})=>lot.tag==='mobile').sort((a,b)=>{
  if(a.lot.date===b.lot.date)return b.index-a.index;
  if(a.lot.date===null)return 1;if(b.lot.date===null)return -1;
  return b.lot.date.localeCompare(a.lot.date);
 }).map(({lot})=>lot);
}
function mobileSummary(s){
 const lots=s.lots.filter(l=>l.tag==='mobile'),qty=lots.reduce((n,l)=>n+l.qty,0),cost=round(lots.reduce((n,l)=>n+l.cost,0)),value=qty===0?0:s.price===null?null:round(s.price*qty),pnl=value===null?null:round(value-cost);
 return {qty,cost,value,pnl,avgPrice:qty?lots.reduce((n,l)=>n+l.price*l.qty,0)/qty:null,avgDays:qty&&lots.every(l=>l.date!==null)?lots.reduce((n,l)=>n+days(l.date)*l.qty,0)/qty:null,pct:cost&&pnl!==null?pnl/cost*100:null};
}
function settleMobileAll(s,price,settings,date=today()){
 if(!finite(price,.000001,1e7))throw Error('请输入有效卖出价格。');
 const lots=s.lots.filter(l=>l.tag==='mobile');checkSaleDate(lots,date);const before=lots.map(l=>snapshotLot(s,l));
 const st=mobileSummary(s);if(!st.qty)throw Error('暂无机动仓');
 const gross=round(price*st.qty),fees=fee(gross,'sell',s.kind,settings),net=round(gross-fees),pnl=round(net-st.cost);
 if(s.cash.mobile+net<0)throw Error('卖出费用大于可用金额，请检查费率。');
 s.cash.mobile=round(s.cash.mobile+net);s.realized=round(s.realized+pnl);s.lots=s.lots.filter(l=>l.tag!=='mobile');
 recordSale(s,{date,price,qty:st.qty,fee:fees,cost:st.cost,pnl,legs:lots.map(historyLeg)},before);return {net,pnl,fees};
}
function stats(s){
 const cost=round(s.lots.reduce((n,l)=>n+l.cost,0)),qty=s.lots.reduce((n,l)=>n+l.qty,0),value=qty===0?0:s.price===null?null:round(s.price*qty),cash=round(s.cash.base+s.cash.mobile+s.cash.reserve);
 const base=s.lots.filter(l=>l.tag==='base'),baseCost=round(base.reduce((n,l)=>n+l.cost,0)),baseQty=base.reduce((n,l)=>n+l.qty,0),mobileCost=round(s.lots.filter(l=>l.tag==='mobile').reduce((n,l)=>n+l.cost,0));
 return {cost,qty,value,cash,float:value===null?null:round(value-cost),total:value===null?null:round(value-cost+s.realized),equity:value===null?null:round(value+cash),baseCost,baseQty,adjusted:baseQty?(baseCost-s.realized)/baseQty:null,mobileCost};
}
function settlementImpact(before,after){
 const a=stats(before),b=stats(after),beforePrice=a.qty?(a.cost-before.realized)/a.qty:null,afterPrice=b.qty?(b.cost-after.realized)/b.qty:null;
 return {beforePrice,afterPrice,reduction:beforePrice===null||afterPrice===null?null:beforePrice-afterPrice};
}
// History retains executed costs and fees; changing fee settings never reprices it.
function historyLeg(l){return {lotId:l.id,tag:l.tag,date:l.date,price:l.price,qty:l.qty,fee:l.fee,cost:l.cost};}
const snapshotLot=(s,l)=>({...structuredClone(l),index:s.lots.findIndex(x=>x.id===l.id)});
const sameLot=(a,b)=>a&&b&&['id','tag','source','feeMode','date','price','qty','fee','cost'].every(k=>a[k]===b[k]);
function recordBuy(s,l,addedCapital=0){
 if(l.tag!=='mobile'||l.source!=='buy')return;
 s.history.entries.push({id:uid(),type:'buy',date:l.date,price:l.price,qty:l.qty,fee:l.fee,cost:l.cost,pnl:null,legs:[historyLeg(l)],undo:{before:[],after:[snapshotLot(s,l)],addedCapital}});
}
function recordSale(s,entry,before){
 if(entry.legs.some(l=>l.tag!=='mobile')){s.history.openingRealized=round(s.history.openingRealized+entry.pnl);return;}
 s.history.entries.push({id:uid(),type:'sell',...entry,undo:{before,after:before.map(l=>s.lots.find(x=>x.id===l.id)).filter(Boolean).map(l=>snapshotLot(s,l)),addedCapital:0}});
}
function syncBuyCorrection(s,l,addedCapital){
 // Edit the acquisition only while it has no sales; past executions keep their costs.
 const e=s.history.entries.find(e=>e.type==='buy'&&e.legs[0].lotId===l.id);
 if(!e||s.history.entries.some(e=>e.type==='sell'&&e.legs.some(x=>x.lotId===l.id)))return;
 Object.assign(e,{date:l.date,price:l.price,qty:l.qty,fee:l.fee,cost:l.cost,legs:[historyLeg(l)]});
 e.undo.after=[snapshotLot(s,l)];e.undo.addedCapital=round(e.undo.addedCapital+addedCapital);
}
function undoReason(s,id){
 const index=s.history.entries.findIndex(e=>e.id===id),e=s.history.entries[index];
 if(!e)return '交易记录已不存在。';
 const ids=new Set(e.legs.map(l=>l.lotId));
 if(s.history.entries.slice(index+1).some(next=>next.legs.some(l=>ids.has(l.lotId))))return '请先撤销这笔仓位后续的交易。';
 const current=s.lots.filter(l=>ids.has(l.id));
 if(current.length!==e.undo.after.length||!current.every(l=>e.undo.after.some(a=>sameLot(l,a))))return '这笔仓位已更正，无法直接撤销此前交易。';
 return '';
}
function undoTrade(s,id){
 const reason=undoReason(s,id);if(reason)throw Error(reason);
 const e=s.history.entries.find(e=>e.id===id),ids=new Set(e.legs.map(l=>l.lotId));
 const cashDelta=e.type==='buy'?round(e.cost-e.undo.addedCapital):-round(round(e.price*e.qty)-e.fee);
 const cash=round(s.cash.mobile+cashDelta),topUp=Math.max(0,-cash);
 s.cash.mobile=round(cash+topUp);s.capital=round(s.capital-(e.type==='buy'?e.undo.addedCapital:0)+topUp);
 if(e.type==='sell')s.realized=round(s.realized-e.pnl);
 s.lots=s.lots.filter(l=>!ids.has(l.id));
 for(const saved of [...e.undo.before].sort((a,b)=>a.index-b.index)){const {index,...l}=saved;s.lots.splice(Math.min(index,s.lots.length),0,structuredClone(l));}
 s.history.entries=s.history.entries.filter(x=>x.id!==id);
}
function checkSaleDate(lots,date){
 if(!validDate(date)||date>today()||lots.some(l=>l.date!==null&&date<l.date))throw Error('卖出日期不能早于买入日期或晚于今天。');
}
function monthsBefore(date,months){
 const [y,m,d]=date.split('-').map(Number),first=new Date(Date.UTC(y,m-1-months,1));
 const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
 first.setUTCDate(Math.min(d,last));return first.toISOString().slice(0,10);
}
function historySummary(s,until=today()){
 const sales=s.history.entries.filter(e=>e.type==='sell'&&e.date<=until),sum=entries=>round(entries.reduce((n,e)=>n+e.pnl,0));
 return {total:sum(sales),recorded:sum(sales),opening:s.history.openingRealized,
  periods:[1,6,12].map(months=>({months,from:monthsBefore(until,months),pnl:sum(sales.filter(e=>e.date>=monthsBefore(until,months)))}))};
}
function migrate(raw){
 if(![1,2,3].includes(raw?.version))return raw;const r=structuredClone(raw);
 if(r.version===1){r.version=2;r.settings={...r.settings,commission:.00009,minimum:0,etfCommission:.00005000001,etfMinimum:0};
 r.stocks.forEach(s=>{s.capital=round(s.budget.base+s.budget.mobile+s.budget.reserve);s.lots.forEach(l=>{if(l.tag!=='base'&&!/^m[1-9]\d*$/.test(l.tag))throw Error('旧版标签无效。');l.tag=l.tag==='base'?'base':'mobile';l.source='buy';});delete s.layers;});}
 r.version=4;r.stocks.forEach(s=>{s.history={openingRealized:s.realized,entries:[]};});return r;
}
function validateUndo(e,legs,fail){
 const u=e.undo;
 if(!u||!Array.isArray(u.before)||!Array.isArray(u.after)||u.before.length>20000||u.after.length>20000||!finite(u.addedCapital,0))fail();
 const clean=arr=>{const ids=new Set();return arr.map(l=>{
  if(!l||typeof l.id!=='string'||ids.has(l.id)||!legs.some(x=>x.lotId===l.id)||!Number.isSafeInteger(l.index)||l.index<0||l.index>20000||l.tag!=='mobile')fail();ids.add(l.id);
  let checked;try{checked=lot(l,defaults(),'stock');}catch{fail();}
  if(!finite(l.fee,0)||!finite(l.cost,0)||Math.abs(l.cost-round(l.price*l.qty+l.fee))>.02||l.feeMode==='included'&&l.fee!==0)fail();
  return {...checked,fee:l.fee,cost:l.cost,index:l.index};
 });};
 const before=clean(u.before),after=clean(u.after);
 if(e.type==='buy'){
  if(before.length||after.length!==1||after[0].source!=='buy'||after[0].date!==e.date||!sameLeg(legs[0],after[0]))fail();
 }else{
  if(u.addedCapital!==0||before.length!==legs.length||new Set(legs.map(l=>l.lotId)).size!==legs.length)fail();
  for(const leg of legs){const old=before.find(l=>l.id===leg.lotId),remaining=after.find(l=>l.id===leg.lotId);
   if(!old||old.qty<leg.qty||old.price!==leg.price||old.date!==leg.date)fail();
   const qty=old.qty-leg.qty,fee=qty?round(old.fee*qty/old.qty):0,cost=qty?round(old.price*qty+fee):0;
   if(Math.abs(round(old.cost-cost)-leg.cost)>.02||Math.abs(round(old.fee-fee)-leg.fee)>.02)fail();
   if(qty?!sameLot(remaining,{...old,qty,fee,cost}):!!remaining)fail();
  }
 }
 return {before,after,addedCapital:u.addedCapital};
}
function sameLeg(leg,l){return leg.lotId===l.id&&['tag','date','price','qty','fee','cost'].every(k=>leg[k]===l[k]);}
function validateHistory(history,realized,getId){
 const fail=()=>{throw Error('交易历史数据无效或与已实现盈亏不一致。');};
 if(!history||!finite(history.openingRealized)||!Array.isArray(history.entries)||history.entries.length>50000)fail();
 let legCount=0;
 const entries=history.entries.map(e=>{
  if(!e||!['buy','sell'].includes(e.type)||!finite(e.price,.000001,1e7)||!Number.isSafeInteger(e.qty)||e.qty<=0||e.qty>1e12||!finite(e.cost,0)||!finite(e.fee,0)||!Array.isArray(e.legs)||!e.legs.length||e.legs.length>20000)fail();
  if(!validDate(e.date)||e.date>today())fail();
  legCount+=e.legs.length;if(legCount>200000)fail();
  const legs=e.legs.map(l=>{
   if(!l||typeof l.lotId!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(l.lotId)||l.tag!=='mobile'||!finite(l.price,.000001,1e7)||!Number.isSafeInteger(l.qty)||l.qty<=0||l.qty>1e9||!finite(l.fee,0)||!finite(l.cost,0)||Math.abs(l.cost-round(l.price*l.qty+l.fee))>.02||l.date!==null&&(!validDate(l.date)||l.date>today()))fail();
   if(e.type==='sell'&&l.date!==null&&e.date<l.date)fail();
   return {lotId:l.lotId,tag:l.tag,date:l.date,price:l.price,qty:l.qty,fee:l.fee,cost:l.cost};
  });
  if(legs.reduce((n,l)=>n+l.qty,0)!==e.qty||Math.abs(round(legs.reduce((n,l)=>n+l.cost,0))-e.cost)>.02)fail();
  if(e.type==='sell'){
   if(!finite(e.pnl)||Math.abs(round(round(e.price*e.qty)-e.fee-e.cost)-e.pnl)>.02)fail();
  }else if(e.pnl!==null||legs.length!==1||e.price!==legs[0].price||e.fee!==legs[0].fee)fail();
  const undo=validateUndo(e,legs,fail);
  return {id:getId(e.id),type:e.type,date:e.date,price:e.price,qty:e.qty,fee:e.fee,cost:e.cost,pnl:e.pnl,legs,undo};
 });
 if(Math.abs(round(history.openingRealized+entries.reduce((n,e)=>n+(e.type==='sell'?e.pnl:0),0))-realized)>.02)fail();
 return {openingRealized:history.openingRealized,entries};
}
function validate(input){
 const r=migrate(input);if(!r||r.version!==4||!Array.isArray(r.stocks)||r.stocks.length>300)throw Error('不是受支持的持仓备份。');
 const fontPercent=r.view?.fontPercent??120;if(!Number.isInteger(fontPercent)||fontPercent<80||fontPercent>160)throw Error('字号百分比应为80至160。');
 const theme=r.view?.theme??'light';if(!['light','dark'].includes(theme))throw Error('主题设置无效。');
 const language=r.view?.language??'en';if(!['zh','en'].includes(language))throw Error('语言设置无效。');
 const settings={};for(const k of Object.keys(defaults())){if(!finite(r.settings?.[k],0,k.toLowerCase().includes('minimum')?10000:.1))throw Error('备份费率无效。');settings[k]=r.settings[k];}
 const ids=new Set(),getId=id=>{if(typeof id!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(id)||ids.has(id))throw Error('记录编号无效或重复。');ids.add(id);return id;};
 const stocks=r.stocks.map(s=>{
  const t=makeStock({name:s.name,code:s.code,kind:s.kind,...s.budget,mobileTargetQty:s.mobileTargetQty??0});t.id=getId(s.id);
  for(const k of ['base','mobile','reserve']){if(!finite(s.cash?.[k],0))throw Error('现金数据无效。');t.cash[k]=s.cash[k];}
  if(!finite(s.capital)||!finite(s.realized))throw Error('资金数据无效。');t.capital=s.capital;t.realized=s.realized;
  if(!Array.isArray(s.lots)||s.lots.length>20000||!Array.isArray(s.quotes)||s.quotes.length>30000)throw Error('记录数量无效。');
  t.lots=s.lots.map(l=>{const clean=lot({...l,id:getId(l.id)},settings,t.kind);if(!finite(l.fee,0)||!finite(l.cost,0)||Math.abs(l.cost-round(l.price*l.qty+l.fee))>.02||(l.feeMode|| (l.source==='opening'?'included':'auto'))==='included'&&l.fee!==0)throw Error('持仓成本数据无效。');clean.fee=l.fee;clean.cost=l.cost;return clean;});
  t.history=validateHistory(s.history,t.realized,getId);
  const dates=new Set();t.quotes=s.quotes.map(q=>{if(!validDate(q.date)||q.date>today()||!finite(q.price,.000001,1e7)||dates.has(q.date))throw Error('报价数据无效。');dates.add(q.date);return{date:q.date,price:q.price};}).sort((a,b)=>a.date.localeCompare(b.date));t.price=t.quotes.at(-1)?.price??null;t.priceDate=t.quotes.at(-1)?.date??null;
  const st=stats(t);if(Math.abs(st.cash+st.cost-t.capital-t.realized)>.1)throw Error('现金、持仓与盈亏无法对账。');return t;
 });
 if(new Set(stocks.filter(s=>s.code).map(s=>s.code)).size!==stocks.filter(s=>s.code).length)throw Error('股票代码重复。');return {version:4,settings,view:{fontPercent,theme,language},stocks,lastBackup:typeof r.lastBackup==='string'?r.lastBackup:null};
}
root.LedgerCore={round,today,uid,validDate,days,defaults,empty,fee,makeStock,addLot,initialize,settle,removeLot,correctLot,configure,quote,stats,migrate,validate,groupOf,inferKind,createPosition,handsToShares,holdingTotals,sortedMobileLots,mobileSummary,settleMobileAll,settlementImpact,historySummary,monthsBefore,undoReason,undoTrade};if(typeof module!=='undefined')module.exports=root.LedgerCore;
})(globalThis);
