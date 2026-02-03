import{e,z as t,R as r,F as n,j as o,O as c,r as l}from"./index-B0Z5MnAS.js";
/**
 * @license lucide-react v0.541.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const s=e("chevron-right",[["path",{d:"m9 18 6-6-6-6",key:"mthhwq"}]]);function i(e){const l=e+"CollectionProvider",[s,i]=t(l),[a,u]=s(l,{collectionRef:{current:null},itemMap:new Map}),f=e=>{const{scope:t,children:n}=e,c=r.useRef(null),l=r.useRef(new Map).current;return o.jsx(a,{scope:t,itemMap:l,collectionRef:c,children:n})};f.displayName=l;const d=e+"CollectionSlot",m=c(d),p=r.forwardRef((e,t)=>{const{scope:r,children:c}=e,l=u(d,r),s=n(t,l.collectionRef);return o.jsx(m,{ref:s,children:c})});p.displayName=d;const h=e+"CollectionItemSlot",R="data-radix-collection-item",x=c(h),C=r.forwardRef((e,t)=>{const{scope:c,children:l,...s}=e,i=r.useRef(null),a=n(t,i),f=u(h,c);return r.useEffect(()=>(f.itemMap.set(i,{ref:i,...s}),()=>{f.itemMap.delete(i)})),o.jsx(x,{[R]:"",ref:a,children:l})});return C.displayName=h,[{Provider:f,Slot:p,ItemSlot:C},function(t){const n=u(e+"CollectionConsumer",t);return r.useCallback(()=>{const e=n.collectionRef.current;if(!e)return[];const t=Array.from(e.querySelectorAll(`[${R}]`));return Array.from(n.itemMap.values()).sort((e,r)=>t.indexOf(e.ref.current)-t.indexOf(r.ref.current))},[n.collectionRef,n.itemMap])},i]}var a=l.createContext(void 0);function u(e){const t=l.useContext(a);return e||t||"ltr"}export{s as C,i as c,u};
//# sourceMappingURL=index-BMP07oTF.js.map
