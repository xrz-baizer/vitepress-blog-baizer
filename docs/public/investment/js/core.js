(function(root){
'use strict';
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const uid=()=>globalThis.crypto?.randomUUID?.()||`id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const days=(date,until=today())=>date===null?null:Math.max(0,Math.floor((Date.parse(until)-Date.parse(date))/86400000));
const defaults=()=>({commission:.00009,minimum:0,stamp:.0005,transfer:.00001,etfCommission:.00005000001,etfMinimum:0});
const empty=()=>({version:2,settings:defaults(),view:{fontPercent:100,theme:'light',language:'en'},stocks:[],lastBackup:null});
const finite=(n,min=-1e12,max=1e12)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const groupOf=tag=>tag==='base'?'base':'mobile';
function fee(amount,side,kind,s){return round(round(Math.max(kind==='etf'?s.etfMinimum:s.minimum,amount*(kind==='etf'?s.etfCommission:s.commission)))+(kind==='etf'?0:round(amount*s.transfer))+(kind==='etf'||side==='buy'?0:round(amount*s.stamp)));}
const inferKind=name=>/ETF|LOF|基金|标普\s*500|纳指/i.test(name)?'etf':'stock';
function handsToShares(hands){
 const qty=Math.round(hands*100);if(!finite(hands,.01,1e7)||!Number.isSafeInteger(qty)||Math.abs(hands*100-qty)>.000001)throw Error('请输入有效手数，最多保留两位小数。');return qty;
}
function holdingTotals(stocks){
 let profit=0,loss=0;for(const s of stocks){if(s.price===null&&s.lots.length)return{profit:null,loss:null};for(const l of s.lots){const p=round(s.price*l.qty-l.cost);if(p>0)profit+=p;else loss+=p;}}return{profit:round(profit),loss:round(loss)};
}

function makeStock({name,code='',kind,base,mobile,reserve}){
 kind=kind||inferKind(name);
 if(typeof name!=='string'||!name.trim()||!(code===''||typeof code==='string'&&/^\d{6}$/.test(code))||!['stock','etf'].includes(kind))throw Error('请填写有效的股票名称。');
 if(![base,mobile,reserve].every(n=>finite(n,0,1e9))||base+mobile+reserve<=0)throw Error('请填写有效的资金配置。');
 const budget={base:round(base),mobile:round(mobile),reserve:round(reserve)};
 return {id:uid(),name:name.trim().slice(0,40),code,kind,budget,cash:{...budget},capital:round(base+mobile+reserve),price:null,priceDate:null,quotes:[],realized:0,lots:[]};
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
function addLot(s,args,settings,{allowTopUp=false}={}){const l=lot(args,settings,s.kind),group=groupOf(l.tag);
 if(allowTopUp&&group==='mobile'&&l.cost>s.cash.mobile){const added=round(l.cost-s.cash.mobile);s.cash.mobile=round(s.cash.mobile+added);s.capital=round(s.capital+added);}
 if(l.cost>s.cash[group]+.001)throw Error(`${group==='base'?'底仓':'机动'}可用现金不足（需要 ${l.cost.toFixed(2)} 元，可用 ${s.cash[group].toFixed(2)} 元）。`);
 s.cash[group]=round(s.cash[group]-l.cost);s.lots.push(l);if(s.price===null)quote(s,l.price,l.date||today());return l;
}
function initialize(s,entries,cash,price,settings){
 if(s.lots.length||s.realized)throw Error('已有记录的股票不能重复初始化。');if(!entries.length)throw Error('请至少录入一笔已有持仓，或选择新建空仓。');
 const lots=entries.map(e=>lot({...e,date:e.date||null,source:'opening'},settings,s.kind));
 for(const k of ['base','mobile','reserve'])if(!finite(cash[k],0,1e9))throw Error('请填写实际剩余现金，满仓时可填0。');
 s.lots=lots;s.cash={base:round(cash.base),mobile:round(cash.mobile),reserve:round(cash.reserve)};s.capital=round(lots.reduce((n,l)=>n+l.cost,0)+s.cash.base+s.cash.mobile+s.cash.reserve);if(price!==null)quote(s,price);return s;
}
function createPosition({name,price,basePrice,baseQty,mobileAmount},settings){
 if(!finite(price,.000001,1e7))throw Error('请填写大于0的现价。');
 const initial=lot({price:basePrice,qty:baseQty,tag:'base',source:'opening',feeMode:'included',date:today()},settings,inferKind(name));
 mobileAmount=mobileAmount??initial.cost;if(!finite(mobileAmount,0,1e9))throw Error('机动资金必须是有效的非负金额。');mobileAmount=round(mobileAmount);
 const s=makeStock({name,base:initial.cost,mobile:mobileAmount,reserve:0});
 initialize(s,[{price:basePrice,qty:baseQty,tag:'base',feeMode:'included',date:today()}],{base:0,mobile:mobileAmount,reserve:0},price,settings);return s;
}

function settle(s,id,price,settings,qty){
 const l=s.lots.find(l=>l.id===id);if(!l)throw Error('这笔持仓已不存在。');if(!finite(price,.000001,1e7))throw Error('请输入有效卖出价格。');
 qty=qty??l.qty;if(!Number.isSafeInteger(qty)||qty<=0||qty>l.qty)throw Error('卖出股数不能超过这笔剩余持仓。');
 const remain=l.qty-qty,remainingFee=remain?round(l.fee*remain/l.qty):0,remainingCost=remain?round(l.price*remain+remainingFee):0,soldCost=round(l.cost-remainingCost);
 const gross=round(price*qty),fees=fee(gross,'sell',s.kind,settings),net=round(gross-fees),pnl=round(net-soldCost),group=groupOf(l.tag);
 if(s.cash[group]+net<0)throw Error('卖出费用大于可用金额，请检查费率。');s.cash[group]=round(s.cash[group]+net);s.realized=round(s.realized+pnl);
 if(remain){l.qty=remain;l.fee=remainingFee;l.cost=remainingCost;}else s.lots=s.lots.filter(x=>x.id!==id);return {net,pnl,fees,remaining:remain};
}
function removeLot(s,id){const l=s.lots.find(x=>x.id===id);if(!l)throw Error('记录已不存在。');if(l.source==='opening')s.capital=round(s.capital-l.cost);else s.cash[groupOf(l.tag)]=round(s.cash[groupOf(l.tag)]+l.cost);s.lots=s.lots.filter(x=>x.id!==id);}
function correctLot(s,id,args,settings){
 const old=s.lots.find(l=>l.id===id);if(!old)throw Error('记录已不存在。');const next=lot({...args,id,source:old.source,feeMode:old.source==='opening'?(args.feeMode||old.feeMode||'included'):'auto'},settings,s.kind);
 if(old.price===next.price&&old.qty===next.qty&&old.feeMode===next.feeMode){next.fee=old.fee;next.cost=old.cost;}
 if(old.source==='opening'){s.capital=round(s.capital+next.cost-old.cost);s.lots=s.lots.map(l=>l.id===id?next:l);return next;}
 const a=groupOf(old.tag),b=groupOf(next.tag),cash={...s.cash};cash[a]=round(cash[a]+old.cost);cash[b]=round(cash[b]-next.cost);
 if(cash[b]<0)throw Error('更正后的成本超过可用资金，请先调整资金配置。');s.cash=cash;s.lots=s.lots.map(l=>l.id===id?next:l);return next;
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
function stats(s){
 const cost=round(s.lots.reduce((n,l)=>n+l.cost,0)),qty=s.lots.reduce((n,l)=>n+l.qty,0),value=qty===0?0:s.price===null?null:round(s.price*qty),cash=round(s.cash.base+s.cash.mobile+s.cash.reserve);
 const base=s.lots.filter(l=>l.tag==='base'),baseCost=round(base.reduce((n,l)=>n+l.cost,0)),baseQty=base.reduce((n,l)=>n+l.qty,0),mobileCost=round(s.lots.filter(l=>l.tag==='mobile').reduce((n,l)=>n+l.cost,0));
 return {cost,qty,value,cash,float:value===null?null:round(value-cost),total:value===null?null:round(value-cost+s.realized),equity:value===null?null:round(value+cash),baseCost,baseQty,adjusted:baseQty?(baseCost-s.realized)/baseQty:null,mobileCost};
}
function migrate(raw){
 if(raw?.version!==1)return raw;const r=structuredClone(raw);r.version=2;r.settings={...r.settings,commission:.00009,minimum:0,etfCommission:.00005000001,etfMinimum:0};
 r.stocks.forEach(s=>{s.capital=round(s.budget.base+s.budget.mobile+s.budget.reserve);s.lots.forEach(l=>{if(l.tag!=='base'&&!/^m[1-9]\d*$/.test(l.tag))throw Error('旧版标签无效。');l.tag=l.tag==='base'?'base':'mobile';l.source='buy';});delete s.layers;});return r;
}
function validate(input){
 const r=migrate(input);if(!r||r.version!==2||!Array.isArray(r.stocks)||r.stocks.length>300)throw Error('不是受支持的持仓备份。');
 const fontPercent=r.view?.fontPercent??100;if(!Number.isInteger(fontPercent)||fontPercent<80||fontPercent>160)throw Error('字号百分比应为80至160。');
 const theme=r.view?.theme??'light';if(!['light','dark'].includes(theme))throw Error('主题设置无效。');
 const language=r.view?.language??'en';if(!['zh','en'].includes(language))throw Error('语言设置无效。');
 const settings={};for(const k of Object.keys(defaults())){if(!finite(r.settings?.[k],0,k.toLowerCase().includes('minimum')?10000:.1))throw Error('备份费率无效。');settings[k]=r.settings[k];}
 const ids=new Set(),getId=id=>{if(typeof id!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(id)||ids.has(id))throw Error('记录编号无效或重复。');ids.add(id);return id;};
 const stocks=r.stocks.map(s=>{
  const t=makeStock({name:s.name,code:s.code,kind:s.kind,...s.budget});t.id=getId(s.id);
  for(const k of ['base','mobile','reserve']){if(!finite(s.cash?.[k],0))throw Error('现金数据无效。');t.cash[k]=s.cash[k];}
  if(!finite(s.capital)||!finite(s.realized))throw Error('资金数据无效。');t.capital=s.capital;t.realized=s.realized;
  if(!Array.isArray(s.lots)||s.lots.length>20000||!Array.isArray(s.quotes)||s.quotes.length>30000)throw Error('记录数量无效。');
  t.lots=s.lots.map(l=>{const clean=lot({...l,id:getId(l.id)},settings,t.kind);if(!finite(l.fee,0)||!finite(l.cost,0)||Math.abs(l.cost-round(l.price*l.qty+l.fee))>.02||(l.feeMode|| (l.source==='opening'?'included':'auto'))==='included'&&l.fee!==0)throw Error('持仓成本数据无效。');clean.fee=l.fee;clean.cost=l.cost;return clean;});
  const dates=new Set();t.quotes=s.quotes.map(q=>{if(!validDate(q.date)||q.date>today()||!finite(q.price,.000001,1e7)||dates.has(q.date))throw Error('报价数据无效。');dates.add(q.date);return{date:q.date,price:q.price};}).sort((a,b)=>a.date.localeCompare(b.date));t.price=t.quotes.at(-1)?.price??null;t.priceDate=t.quotes.at(-1)?.date??null;
  const st=stats(t);if(Math.abs(st.cash+st.cost-t.capital-t.realized)>.1)throw Error('现金、持仓与盈亏无法对账。');return t;
 });
 if(new Set(stocks.filter(s=>s.code).map(s=>s.code)).size!==stocks.filter(s=>s.code).length)throw Error('股票代码重复。');return {version:2,settings,view:{fontPercent,theme,language},stocks,lastBackup:typeof r.lastBackup==='string'?r.lastBackup:null};
}
root.LedgerCore={round,today,uid,validDate,days,defaults,empty,fee,makeStock,addLot,initialize,settle,removeLot,correctLot,configure,quote,stats,migrate,validate,groupOf,inferKind,createPosition,handsToShares,holdingTotals,sortedMobileLots};if(typeof module!=='undefined')module.exports=root.LedgerCore;
})(globalThis);
