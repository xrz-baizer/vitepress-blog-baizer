'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const C=require('../js/core.js');
const stub={addEventListener(){}};
const context=vm.createContext({LedgerCore:C,Intl,Event,document:{querySelector:()=>stub,addEventListener(){}}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/i18n.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/app.js'),'utf8').replace(' render();init();',''),context);
function input(value,{step=.01,min=.001,max=10000000}={}){
 return {value:String(value),min:String(min),max:String(max),dataset:{stepSize:String(step)},events:[],
  get valueAsNumber(){return this.value.trim()===''?NaN:Number(this.value);},
  dispatchEvent(event){this.events.push(event);}};
}
function click(el,direction){context.el=el;context.direction=direction;vm.runInContext('stepNumberInput(el,direction)',context);}

test('price clicks add one cent, preserve three displayed decimals and emit input events',()=>{
 const price=input(6.123);click(price,1);click(price,1);assert.equal(price.value,'6.143');
 click(price,-1);assert.equal(price.value,'6.133');
 assert.equal(price.events.length,3);assert.ok(price.events.every(e=>e.type==='input'&&e.bubbles));
 assert.equal(price.dataset.dirty,'1');
 const decimal=input(.1);for(let i=0;i<20;i++)click(decimal,1);assert.equal(decimal.value,'0.3');
});
test('quantity clicks obey whole lots, zero targets and sale limits',()=>{
 const qty=input(1,{step:1,min:1,max:3});click(qty,1);click(qty,1);click(qty,1);
 assert.equal(qty.value,'3');assert.equal(qty.events.length,2);
 for(let i=0;i<4;i++)click(qty,-1);assert.equal(qty.value,'1');
 const target=input(1,{step:1,min:0});click(target,-1);click(target,-1);assert.equal(target.value,'0');
 const partial=input(1.5,{step:1,min:1,max:10});click(partial,1);assert.equal(partial.value,'2');
});
test('boundary clicks leave untouched high precision values and unrelated fields intact',()=>{
 const price=input(.001);price.dataset.rawValue='0.0010000000123';
 click(price,-1);assert.equal(price.dataset.dirty,undefined);assert.equal(price.events.length,0);
 const qty=input(1,{step:1,min:1});click(qty,1);assert.equal(price.dataset.rawValue,'0.0010000000123');
 const maximum=input(10000000);click(maximum,1);assert.equal(maximum.events.length,0);
 const empty=input('');click(empty,1);assert.equal(empty.value,'0.01');
 const locked=input(10);locked.readOnly=true;click(locked,1);assert.equal(locked.value,'10');
});
test('controls update disabled directions when typed values move off the bounds',()=>{
 const qty=input(1,{step:1,min:1,max:3}),minus={},plus={};
 const control={querySelector:selector=>selector==='input'?qty:selector.includes('"-1"')?minus:plus};
 context.form={querySelectorAll:()=>[control]};vm.runInContext('syncSteppers(form)',context);
 assert.equal(minus.disabled,true);assert.equal(plus.disabled,false);
 qty.value='3';vm.runInContext('syncSteppers(form)',context);assert.equal(minus.disabled,false);assert.equal(plus.disabled,true);
 qty.value='2';vm.runInContext('syncSteppers(form)',context);assert.equal(minus.disabled,false);assert.equal(plus.disabled,false);
});
