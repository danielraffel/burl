import { describe,expect,it } from 'vitest';
import { lowerObservedDom,toNativeDesignIrV1,type ObservedDomNode } from '../src/index.js';
const lower=(margin:string,sides:Record<string,string>={})=>lowerObservedDom({sourceId:'margin',tagName:'div',rect:{x:0,y:0,width:20,height:20},children:[],computedStyle:{display:'flex',margin,...sides}} as ObservedDomNode,'now');
describe('observed CSS margin family',()=>{
 it.each([
  ['8px',{marginTop:8,marginRight:8,marginBottom:8,marginLeft:8}],
  ['8px 2px',{marginTop:8,marginRight:2,marginBottom:8,marginLeft:2}],
  ['0px 0px 16px',{marginTop:0,marginRight:0,marginBottom:16,marginLeft:0}],
  ['0px 12px 12px 0px',{marginTop:0,marginRight:12,marginBottom:12,marginLeft:0}],
  ['0px 0px 16px 43.75px',{marginTop:0,marginRight:0,marginBottom:16,marginLeft:43.75}],
  ['0px 0px 0px 659.781px',{marginTop:0,marginRight:0,marginBottom:0,marginLeft:659.781}],
  ['-1px',{marginTop:-1,marginRight:-1,marginBottom:-1,marginLeft:-1}],
 ])('expands %s in CSS order',(source,expected)=>{const ir=lower(source);expect(ir.layout).toMatchObject(expected);expect(toNativeDesignIrV1(ir,{sourceFile:'/margin',importedAt:'now'}).root.layout).toMatchObject(expected);});
 it('lets computed sides override shorthand coherently',()=>{expect(lower('8px',{marginLeft:'2px',marginTop:'-1px'}).layout).toMatchObject({marginTop:-1,marginRight:8,marginBottom:8,marginLeft:2});});
 it('applies explicit block collapse policy',()=>{const root=lowerObservedDom({sourceId:'root',tagName:'div',rect:{x:0,y:0,width:100,height:32},computedStyle:{display:'block'},children:[{sourceId:'a',tagName:'div',rect:{x:0,y:0,width:100,height:10},computedStyle:{display:'block',marginTop:'0px',marginBottom:'8px'},children:[]},{sourceId:'b',tagName:'div',rect:{x:0,y:22,width:100,height:10},computedStyle:{display:'block',marginTop:'12px',marginBottom:'0px'},children:[]}]} as ObservedDomNode,'now');expect(root.layout?.display).toBe('flex');expect(root.children[1].layout?.marginTop).toBe(12);});
 it('fails closed calc percent and overlong shorthand',()=>{for(const value of ['calc(1px + 1vw)','10%','1px 2px 3px 4px 5px']){const ir=lower(value);expect(ir.meta?.observed_style_diagnostics).toContainEqual(expect.objectContaining({property:'margin',value,code:'css-length-unsupported'}));}});
});
