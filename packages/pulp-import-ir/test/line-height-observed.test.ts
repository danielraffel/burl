import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';
const values=[10,13,13.75,15,16.25,16.5,18,22,24];
const lower=(lineHeight:string)=>lowerObservedDom({sourceId:'line',tagName:'p',text:'one\ntwo',rect:{x:0,y:0,width:100,height:48},children:[],computedStyle:{display:'block',fontSize:'13px',lineHeight,whiteSpace:'pre-wrap'}} as ObservedDomNode,'now');
describe('observed line-height',()=>{
 it('preserves all observed pixel values through NativeDesignIR',()=>{for(const value of values){const ir=lower(`${value}px`);expect(ir.text?.lineHeight).toBe(value);expect(toNativeDesignIrV1(ir,{sourceFile:'/line',importedAt:'now'}).root.style?.lineHeight).toBe(value);}});
 it('maps normal to explicit native auto line metrics',()=>{expect(lower('normal').text?.lineHeight).toBe(0);});
 it('fails closed unsupported units',()=>{for(const value of ['1.5','1.2em','calc(1em + 2px)']){const ir=lower(value);expect(ir.text?.lineHeight).toBeUndefined();expect(ir.meta?.observed_style_diagnostics).toContainEqual(expect.objectContaining({property:'lineHeight',value,code:'css-length-unsupported'}));}});
});
