import{a as u}from"./vendor-BhvhDhpY.js";import{G as c}from"./ui-D2YqbPcu.js";const a=(n,o)=>u.useMemo(()=>{const r={};return Object.entries(n).forEach(([e,s])=>{if(s){const t=o(s);r[s]=t}}),r},[n,o]),i=(n,o)=>u.useMemo(()=>{const r=Object.values(n).reduce((e,s)=>{if(!s)return e;const t=o[s];return t!=null&&t.setBonus&&(e[t.setBonus]=(e[t.setBonus]||0)+1),e},{});return Object.entries(r).flatMap(([e,s])=>{var f;const t=Math.floor(s/(((f=c[e])==null?void 0:f.minPieces)||2));return Array(t).fill(e)})},[n,o]);function m(n,o){return u.useMemo(()=>{const r={},e={};return Object.values((n==null?void 0:n.equipment)||{}).forEach(s=>{if(!s)return;const t=o[s];t!=null&&t.setBonus&&(r[t.setBonus]=(r[t.setBonus]||0)+1,e[t.setBonus]||(e[t.setBonus]=[]),e[t.setBonus].push(t))}),Object.entries(r).filter(([s,t])=>t<2).flatMap(([s])=>e[s]||[])},[n==null?void 0:n.equipment,o])}export{i as a,m as b,a as u};
