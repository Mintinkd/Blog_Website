const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["_assets/LikeButton.SmRETTjD.js","_assets/_plugin-vue_export-helper.DlAUqK2U.js","_assets/runtime-core.esm-bundler.Bxi63x_M.js","_assets/CommentSection.CEcOtaxA.js","_assets/runtime-dom.esm-bundler.CFA9ZbRW.js","_assets/purify.es.D6gMnemd.js","_assets/markdown.CdwltysG.js","_assets/index.DqyilKdn.js","_assets/_commonjsHelpers.CqkleIqs.js"])))=>i.map(i=>d[i]);
import{_ as u}from"./preload-helper.BlTxHScW.js";import{t as o,g as b}from"./i18n.Bppg9S7s.js";import{g as k,c as w}from"./categoryColors.C23KiAO5.js";import{a as p}from"./runtime-dom.esm-bundler.CFA9ZbRW.js";import"./runtime-core.esm-bundler.Bxi63x_M.js";async function C(e,a){const r=document.getElementById("like-button-mount");if(r){const{default:c}=await u(async()=>{const{default:t}=await import("./LikeButton.SmRETTjD.js");return{default:t}},__vite__mapDeps([0,1,2]));p(c,{articleId:e,initialCount:a}).mount(r)}const i=document.getElementById("comment-section-mount");if(i){const{default:c}=await u(async()=>{const{default:t}=await import("./CommentSection.CEcOtaxA.js");return{default:t}},__vite__mapDeps([3,4,2,5,1]));p(c,{articleId:e}).mount(i)}}async function g(){const e=document.getElementById("article-detail");if(!e)return;const a=e.dataset.slug;if(!a)return;const i=b()==="zh"?"zh-CN":"en-US";try{const n=await(await fetch(`/api/v1/articles/${a}`)).json();if(n.code===0&&n.data){const t=n.data;document.title=`${t.title} | Blog`;const s=document.querySelector('meta[name="description"]');s&&s.setAttribute("content",t.summary||t.title);let m=t.content_html||"";if(!m&&t.content){const{renderMarkdown:l}=await u(async()=>{const{renderMarkdown:$}=await import("./markdown.CdwltysG.js");return{renderMarkdown:$}},__vite__mapDeps([6,7,8,5]));m=l(t.content)}const v=document.documentElement.getAttribute("data-theme")==="dark",f=l=>String(l||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;"),h=k(t.category?.slug,t.category?.name),d=t.category?w(h,v):null,y=d?`style="background:${d.background};color:${d.color};border:${d.border};"`:"",_=t.cover_image?`<div class="article-banner"><img src="${f(t.cover_image)}" alt="" /></div>`:"";e.innerHTML=`
          <header class="article-header" data-reveal-stagger>
            ${_}
            <div class="article-meta-top" data-reveal="fade-up">
              ${t.category?`<a href="/categories/${t.category.slug}" class="article-category" ${y}>${t.category.name}</a>`:""}
              <span class="article-date">${t.published_at?new Date(t.published_at).toLocaleDateString(i,{year:"numeric",month:"long",day:"numeric"}):""}</span>
            </div>
            <h1 class="article-title" data-reveal="fade-up">${t.title}</h1>
            ${t.summary?`<p class="article-summary" data-reveal="fade-up">${t.summary}</p>`:""}
            <div class="article-meta-bottom" data-reveal="fade-up">
              <span class="meta-item">${t.view_count} ${o("article.views")}</span>
              <span class="meta-item">${t.like_count} ${o("article.likes")}</span>
              <span class="meta-item">${t.reading_time||1} ${o("article.minutes_read")}</span>
            </div>
            <div class="article-tags" data-reveal="fade-up">
              ${(t.tags||[]).map(l=>`<a href="/tags/${l.slug}" class="article-tag">${l.name}</a>`).join("")}
            </div>
          </header>
          <div class="article-content prose">${m}</div>
          <div class="article-actions">
            <div id="like-button-mount" data-article-id="${t.id}"></div>
          </div>
          <div id="comment-section-mount"></div>
        `,window.dispatchEvent(new CustomEvent("motion:refresh")),E(e),C(t.id,t.like_count||0)}else e.innerHTML=`<div class="article-not-found"><h2>${o("article.not_found")}</h2><p>${o("article.check_link")}</p><a href="/" class="back-link">${o("article.back_home")}</a></div>`}catch{e.innerHTML=`<div class="article-not-found"><p>${o("article.load_error")}</p><a href="/" class="back-link">${o("article.back_home")}</a></div>`}}function E(e){e.querySelectorAll("pre").forEach(a=>{if(a.dataset.enhanced)return;a.dataset.enhanced="1";const r=a.querySelector("code"),i=r?.className.match(/language-([\w+-]+)/),c=i?i[1]:"",n=document.createElement("div");if(n.className="code-bar",c){const s=document.createElement("span");s.className="code-lang",s.textContent=c,n.appendChild(s)}const t=document.createElement("button");t.type="button",t.className="code-copy",t.textContent="复制",t.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(r?.textContent||a.textContent||""),t.textContent="已复制"}catch{t.textContent="复制失败"}setTimeout(()=>t.textContent="复制",1600)}),n.appendChild(t),a.prepend(n)})}g();document.addEventListener("locale-changed",()=>g());
