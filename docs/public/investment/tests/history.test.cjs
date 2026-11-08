'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const C=require('../js/core.js');
const settings={...C.defaults(),minimum:5};
function fixture(){const state=C.empty();state.settings=settings;const s=C.createPosition({name:'测试股票',price:10,basePrice:10,baseQty:1000,mobileAmount:0},settings);state.stocks.push(s);return {state,s};}
function buy(s,price=8,qty=300,date='2025-01-01'){return C.addLot(s,{price,qty,date},settings,{allowTopUp:true});}
function validate(state){const clean=C.validate(JSON.parse(JSON.stringify(state)));assert.deepEqual(clean,state);return clean;}

test('partial and final sales preserve costs, fees, dates and complete history',()=>{
 const {state,s}=fixture(),l=buy(s),original=structuredClone(l),originalCost=l.cost;
 const first=C.settle(s,l.id,9,settings,100,'2025-02-01');
 const sale=s.history.entries.at(-1);
 assert.equal(sale.cost+l.cost,originalCost);assert.equal(sale.legs[0].fee+l.fee,original.fee);
 assert.equal(sale.pnl,first.pnl);assert.equal(l.qty,200);assert.equal(l.date,'2025-01-01');
 C.settle(s,l.id,7,settings,200,'2025-03-01');
 assert.equal(s.history.entries.filter(e=>e.type==='buy')[0].qty,300);
 assert.equal(s.history.entries.filter(e=>e.type==='sell').reduce((n,e)=>n+e.cost,0),originalCost);
 assert.equal(C.historySummary(s).total,s.realized);assert.equal(s.lots.length,1);validate(state);
});
test('bulk sale charges minimum commission once and retains every cost lot',()=>{
 const {state,s}=fixture();buy(s,8,100);buy(s,9,200);const lots=structuredClone(s.lots.filter(l=>l.tag==='mobile'));
 const result=C.settleMobileAll(s,10,settings,'2025-04-01'),sale=s.history.entries.at(-1);
 assert.equal(result.fees,C.fee(3000,'sell',s.kind,settings));assert.equal(sale.legs.length,2);
 assert.deepEqual(sale.legs.map(l=>l.lotId),lots.map(l=>l.id));assert.equal(sale.cost,C.round(lots.reduce((n,l)=>n+l.cost,0)));
 assert.equal(sale.qty,300);assert.equal(s.lots.length,1);validate(state);
});
test('v2 migration keeps prior realized P&L separate and never changes original input',()=>{
 const {state,s}=fixture();const l=buy(s);C.settle(s,l.id,9,settings,100,'2025-02-01');
 const legacy=structuredClone(state);legacy.version=2;delete legacy.stocks[0].history;const copy=structuredClone(legacy);
 const migrated=C.validate(legacy),item=migrated.stocks[0];assert.deepEqual(legacy,copy);
 assert.equal(migrated.version,4);assert.equal(item.realized,s.realized);assert.equal(item.history.openingRealized,s.realized);
 assert.deepEqual(item.history.entries,[]);
 assert.equal(C.historySummary(item).recorded,0);assert.equal(C.historySummary(item).total,0);
 C.settle(item,item.lots.find(l=>l.tag==='mobile').id,10,settings,100);
 assert.equal(C.historySummary(item).total,C.round(item.realized-s.realized));validate(migrated);
});
test('v1 remains importable through the v4 migration',()=>{
 const {state,s}=fixture();const legacy=structuredClone(state);legacy.version=1;delete legacy.stocks[0].history;
 legacy.stocks[0].lots.forEach(l=>{delete l.source;delete l.feeMode;});
 const restored=C.validate(legacy);assert.equal(restored.version,4);assert.equal(restored.stocks[0].history.entries.length,0);
 assert.equal(restored.stocks[0].realized,s.realized);
});
test('rolling calendar windows clamp month ends, include both boundaries and exclude later sales',()=>{
 assert.equal(C.monthsBefore('2024-03-31',1),'2024-02-29');assert.equal(C.monthsBefore('2025-03-31',1),'2025-02-28');
 assert.equal(C.monthsBefore('2024-02-29',12),'2023-02-28');
 const entries=[['2024-10-31',1],['2024-11-01',2],['2025-05-01',4],['2025-10-01',8],['2025-11-01',16],['2025-11-02',32]].map(([date,pnl])=>({type:'sell',date,pnl}));
 const summary=C.historySummary({history:{openingRealized:100,entries}},'2025-11-01');
 assert.deepEqual(summary.periods.map(p=>p.pnl),[24,28,30]);assert.equal(summary.total,31);
});
test('invalid sell dates do not mutate holdings or history',()=>{
 const {s}=fixture(),l=buy(s,8,100,'2025-01-02'),before=structuredClone(s);
 assert.throws(()=>C.settle(s,l.id,9,settings,100,'2025-01-01'));assert.deepEqual(s,before);
 assert.throws(()=>C.settleMobileAll(s,9,settings,'2999-01-01'));assert.deepEqual(s,before);
 assert.throws(()=>C.settle(s,l.id,9,settings,100,'2025-02-30'));assert.deepEqual(s,before);
});
test('saved history survives fee changes and rejects damaged backups',()=>{
 const {state,s}=fixture(),l=buy(s);C.settle(s,l.id,9,settings,100,'2025-02-01');
 const before=structuredClone(s.history);state.settings={...settings,minimum:100};validate(state);assert.deepEqual(s.history,before);
 for(const mutate of [x=>x.history.entries.at(-1).pnl++,x=>x.history.entries.at(-1).cost++,x=>x.history.entries.at(-1).legs[0].qty++,x=>x.history.openingRealized++,x=>delete x.history,x=>x.history.entries.at(-1).date='2024-01-01',x=>x.history.entries.at(-1).id=x.history.entries[0].id]){
  const bad=structuredClone(state);mutate(bad.stocks[0]);assert.throws(()=>C.validate(bad));
 }
});
test('holding corrections and voids do not create realized profits',()=>{
 const {state,s}=fixture(),base=s.lots[0];
 const count=s.history.entries.length;C.correctLot(s,base.id,{price:base.price,qty:base.qty,tag:base.tag,date:base.date},settings);assert.equal(s.history.entries.length,count);
 C.correctLot(s,base.id,{price:9,qty:900,tag:'base',date:null},settings);
 assert.equal(s.history.entries.length,0);assert.equal(s.realized,0);
 const l=buy(s);C.removeLot(s,l.id);assert.equal(s.history.entries.length,0);assert.equal(s.realized,0);validate(state);
});
test('sale previews on copies never change the real ledger',()=>{
 const {state,s}=fixture(),l=buy(s),before=structuredClone(state),copy=structuredClone(s);
 C.settle(copy,l.id,9,settings,100);C.settlementImpact(s,copy);assert.deepEqual(state,before);
});
test('rounding stays reconciled across fractional-price partial sales',()=>{
 const {state,s}=fixture();const l=buy(s,1.234567,1100),cost=l.cost;
 for(let i=0;i<11;i++){C.settle(s,l.id,1.30,settings,100,'2025-03-01');validate(state);}
 assert.equal(C.round(s.history.entries.filter(e=>e.type==='sell').reduce((n,e)=>n+e.cost,0)),cost);
});
test('UI history opens last, escapes names, and translates both languages',()=>{
 const elements=new Map();const element=key=>{if(!elements.has(key))elements.set(key,{innerHTML:'',textContent:'',remove(){this.removed=true;},addEventListener(type,fn){this[type]=fn;}});return elements.get(key);};
 const context=vm.createContext({LedgerCore:C,Intl,document:{querySelector:element,addEventListener(){}},console});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/i18n.js'),'utf8'),context);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/app.js'),'utf8').replace(' render();init();',''),context);
 const {s}=fixture();s.name='<img src=x onerror=alert(1)>';s.mobileTargetQty=2000;context.stock=s;
 const markup=vm.runInContext('stockCard(stock)',context);assert.ok(!markup.includes('<img'));assert.ok(markup.includes('&lt;img'));
 assert.ok(markup.indexOf('data-action="history"')>markup.indexOf('data-action="move-down"'));assert.ok(markup.includes('<strong>2,000</strong>'));
 vm.runInContext("state.stocks=[stock];openDialog=(title,sub,body)=>{globalThis.dialogBody=body;};historyDialog(stock.id)",context);
 assert.ok(context.dialogBody.includes('All-time net P&L'));
 assert.ok(element('#history-rows').innerHTML.includes('No trades'));assert.ok(!context.dialogBody.includes('snapshot'));
 assert.equal((element('#history-rows').innerHTML.match(/<tr\b/g)||[]).length,6);
 assert.equal((element('#history-rows').innerHTML.match(/history-placeholder/g)||[]).length,5);
 vm.runInContext("I18n.setLanguage('zh');historyDialog(stock.id)",context);
 assert.ok(context.dialogBody.includes('近半年'));
 for(let i=0;i<6;i++)buy(s,8,100,'2025-01-01');
 vm.runInContext('historyDialog(stock.id)',context);
 assert.equal((element('#history-rows').innerHTML.match(/<tr role="row">/g)||[]).length,6);
 assert.equal(element('.history-pagination').hidden,true);
 buy(s,8,100,'2025-01-01');
 vm.runInContext('historyDialog(stock.id)',context);
 assert.equal((element('#history-rows').innerHTML.match(/<tr role="row">/g)||[]).length,6);
 assert.equal(element('.history-pagination').hidden,false);
 assert.equal(element('#history-next').disabled,false);
 element('#history-next').onclick();
 assert.equal((element('#history-rows').innerHTML.match(/<tr role="row">/g)||[]).length,1);
 assert.equal((element('#history-rows').innerHTML.match(/history-placeholder/g)||[]).length,5);
 assert.equal((element('#history-rows').innerHTML.match(/<tr\b/g)||[]).length,6);
 assert.equal(element('#history-next').disabled,true);
 element('#history-prev').onclick();
 assert.equal(element('#history-prev').disabled,true);
 assert.equal(element('#history-next').disabled,false);
 C.undoTrade(s,s.history.entries[0].id);
 vm.runInContext('historyDialog(stock.id,1)',context);
 assert.equal((element('#history-rows').innerHTML.match(/<tr role="row">/g)||[]).length,6);
 assert.equal(element('.history-pagination').hidden,true);
 assert.equal(element('#history-prev').disabled,true);
});

test('partial, full and bulk sales undo back to exact cost lots after export/import',()=>{
 for(const mode of ['partial','full','bulk']){
  const {state,s}=fixture(),l=buy(s,8.12345,300);buy(s,7.4,200);const before=structuredClone(s);
  if(mode==='bulk')C.settleMobileAll(s,9,settings,'2025-02-01');else C.settle(s,l.id,9,settings,mode==='full'?300:100,'2025-02-01');
  const clean=validate(state),stock=clean.stocks[0];C.undoTrade(stock,stock.history.entries.at(-1).id);
  assert.deepEqual(stock,before);validate(clean);
 }
});
test('undo buy refunds its costs and initial top-up, and removes its history',()=>{
 const {state,s}=fixture(),before=structuredClone(s);buy(s);C.undoTrade(s,s.history.entries[0].id);assert.deepEqual(s,before);validate(state);
});
test('dependent trades must undo newest first, while unrelated lots stay intact',()=>{
 const {state,s}=fixture(),l=buy(s),buyId=s.history.entries[0].id;
 C.settle(s,l.id,9,settings,100,'2025-02-01');const first=s.history.entries.at(-1).id;
 C.settle(s,l.id,10,settings,100,'2025-03-01');const second=s.history.entries.at(-1).id;
 const unrelated=buy(s,6,100),copy=structuredClone(unrelated),before=structuredClone(s);
 assert.throws(()=>C.undoTrade(s,buyId));assert.throws(()=>C.undoTrade(s,first));assert.deepEqual(s,before);
 C.undoTrade(s,second);C.undoTrade(s,first);C.undoTrade(s,buyId);
 assert.deepEqual(s.lots.find(l=>l.id===unrelated.id),copy);assert.equal(s.realized,0);validate(state);
});
test('editing a current buy updates its history and supports undo with extra funding',()=>{
 const {state,s}=fixture(),before=structuredClone(s),l=buy(s);
 C.correctLot(s,l.id,{price:12,qty:500,date:'2025-01-02',tag:'mobile'},settings);
 assert.equal(s.history.entries.length,1);assert.equal(s.history.entries[0].price,12);assert.equal(s.history.entries[0].qty,500);
 validate(state);C.undoTrade(s,s.history.entries[0].id);assert.deepEqual(s,before);validate(state);
});
test('partial lot correction leaves sold profit alone and blocks stale restoration',()=>{
 const {state,s}=fixture(),l=buy(s);C.settle(s,l.id,9,settings,100,'2025-02-01');const sale=s.history.entries.at(-1),pnl=s.realized;
 C.correctLot(s,l.id,{price:7,qty:200,date:'2025-01-03',tag:'mobile'},settings);
 assert.equal(s.realized,pnl);assert.equal(s.history.entries.length,2);assert.ok(C.undoReason(s,sale.id));
 const before=structuredClone(s);assert.throws(()=>C.undoTrade(s,sale.id));assert.deepEqual(s,before);validate(state);
});
test('undo keeps other positions when the proceeds have been reinvested',()=>{
 const {state,s}=fixture(),l=buy(s);C.settle(s,l.id,9,settings,300,'2025-02-01');const sale=s.history.entries.at(-1).id;
 const second=buy(s,20,500),copy=structuredClone(second);C.undoTrade(s,sale);
 assert.deepEqual(s.lots.find(x=>x.id===second.id),copy);assert.equal(s.lots.find(x=>x.id===l.id).qty,300);assert.equal(s.realized,0);assert.equal(s.cash.mobile,0);validate(state);
});
test('v3 history starts empty without altering current positions or old realized profit',()=>{
 const {state,s}=fixture(),l=buy(s);C.settle(s,l.id,9,settings,100,'2025-02-01');state.version=3;
 const copy=structuredClone(state),clean=C.validate(state);assert.deepEqual(state,copy);
 assert.equal(clean.version,4);assert.deepEqual(clean.stocks[0].lots,s.lots);assert.equal(clean.stocks[0].realized,s.realized);
 assert.deepEqual(clean.stocks[0].history.entries,[]);assert.equal(C.historySummary(clean.stocks[0]).total,0);
});
test('tampered undo snapshots are rejected at import',()=>{
 const {state,s}=fixture(),l=buy(s);C.settle(s,l.id,9,settings,100,'2025-02-01');
 for(const mutate of [e=>e.undo.before[0].qty++,e=>e.undo.after[0].fee++,e=>e.undo.before[0].source='invalid',e=>e.undo.before[0].index=-1,e=>e.undo.after=[],e=>delete e.undo]){
  const bad=structuredClone(state);mutate(bad.stocks[0].history.entries.at(-1));assert.throws(()=>C.validate(bad));
 }
});
