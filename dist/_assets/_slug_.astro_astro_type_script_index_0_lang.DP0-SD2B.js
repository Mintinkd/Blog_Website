const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["_assets/LikeButton.SmRETTjD.js","_assets/_plugin-vue_export-helper.DlAUqK2U.js","_assets/runtime-core.esm-bundler.Bxi63x_M.js","_assets/CommentSection.CEcOtaxA.js","_assets/runtime-dom.esm-bundler.CFA9ZbRW.js","_assets/purify.es.D6gMnemd.js","_assets/markdown.CdwltysG.js","_assets/index.DqyilKdn.js","_assets/_commonjsHelpers.CqkleIqs.js"])))=>i.map(i=>d[i]);
import{_ as u}from"./preload-helper.BlTxHScW.js";import{t as o,g as _}from"./i18n.Bppg9S7s.js";import{g as $,c as b,a as k,b as w}from"./categoryColors.B-OBBTpf.js";import{a as p}from"./runtime-dom.esm-bundler.CFA9ZbRW.js";import"./runtime-core.esm-bundler.Bxi63x_M.js";async function C(e,a){const i=document.getElementById("like-button-mount");if(i){const{default:c}=await u(async()=>{const{default:t}=await import("./LikeButton.SmRETTjD.js");return{default:t}},__vite__mapDeps([0,1,2]));p(c,{articleId:e,initialCount:a}).mount(i)}const s=document.getElementById("comment-section-mount");if(s){const{default:c}=await u(async()=>{const{default:t}=await import("./CommentSection.CEcOtaxA.js");return{default:t}},__vite__mapDeps([3,4,2,5,1]));p(c,{articleId:e}).mount(s)}}async function g(){const e=document.getElementById("article-detail");if(!e)return;const a=e.dataset.slug;if(!a)return;const s=_()==="zh"?"zh-CN":"en-US";try{const n=await(await fetch(`/api/v1/articles/${a}`)).json();if(n.code===0&&n.data){const t=n.data;document.title=`${t.title} | Blog`;const r=document.querySelector('meta[name="description"]');r&&r.setAttribute("content",t.summary||t.title);let d=t.content_html||"";if(!d&&t.content){const{renderMarkdown:l}=await u(async()=>{const{renderMarkdown:h}=await import("./markdown.CdwltysG.js");return{renderMarkdown:h}},__vite__mapDeps([6,7,8,5]));d=l(t.content)}const v=l=>String(l||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;"),m=$(t.category?.slug,t.category?.name),y=t.category?b(m):"",f=t.cover_image?`<div class="article-banner"><img src="${v(t.cover_image)}" alt="" /></div>`:`<div class="article-banner article-banner-grad" style="${k(m)}"><span class="banner-cat-name" style="${w(m)}">${t.category?.name||"✦"}</span></div>`;e.innerHTML=`
          <header class="article-header" data-reveal-stagger>
            ${f}
            <div class="article-meta-top" data-reveal="fade-up">
              ${t.category?`<a href="/categories/${t.category.slug}" class="article-category" style="${y}">${t.category.name}</a>`:""}
              <span class="article-date">${t.published_at?new Date(t.published_at).toLocaleDateString(s,{year:"numeric",month:"long",day:"numeric"}):""}</span>
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
          <div class="article-content prose">${d}</div>
          <div class="article-actions">
            <div id="like-button-mount" data-article-id="${t.id}"></div>
          </div>
          <div id="comment-section-mount"></div>
        `,window.dispatchEvent(new CustomEvent("motion:refresh")),E(e),C(t.id,t.like_count||0)}else e.innerHTML=`<div class="article-not-found"><h2>${o("article.not_found")}</h2><p>${o("article.check_link")}</p><a href="/" class="back-link">${o("article.back_home")}</a></div>`}catch{e.innerHTML=`<div class="article-not-found"><p>${o("article.load_error")}</p><a href="/" class="back-link">${o("article.back_home")}</a></div>`}}function E(e){e.querySelectorAll("pre").forEach(a=>{if(a.dataset.enhanced)return;a.dataset.enhanced="1";const i=a.querySelector("code"),s=i?.className.match(/language-([\w+-]+)/),c=s?s[1]:"",n=document.createElement("div");if(n.className="code-bar",c){const r=document.createElement("span");r.className="code-lang",r.textContent=c,n.appendChild(r)}const t=document.createElement("button");t.type="button",t.className="code-copy",t.textContent="复制",t.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(i?.textContent||a.textContent||""),t.textContent="已复制"}catch{t.textContent="复制失败"}setTimeout(()=>t.textContent="复制",1600)}),n.appendChild(t),a.prepend(n)})}g();document.addEventListener("locale-changed",()=>g());
