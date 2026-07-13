const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["_assets/LikeButton.Dk2epVoc.js","_assets/_plugin-vue_export-helper.DlAUqK2U.js","_assets/runtime-core.esm-bundler.deUVDpNT.js","_assets/CommentSection.wD9D_RbO.js","_assets/runtime-dom.esm-bundler.BvFnYLsB.js","_assets/purify.es.D6gMnemd.js","_assets/markdown.CdwltysG.js","_assets/index.DqyilKdn.js","_assets/_commonjsHelpers.CqkleIqs.js"])))=>i.map(i=>d[i]);
import{_ as d}from"./preload-helper.BlTxHScW.js";import{t as a,getLocale as f}from"./i18n.CQj9Tpoy.js";import{a as u}from"./runtime-dom.esm-bundler.BvFnYLsB.js";import"./runtime-core.esm-bundler.deUVDpNT.js";async function v(e,c){const r=document.getElementById("like-button-mount");if(r){const{default:n}=await d(async()=>{const{default:t}=await import("./LikeButton.Dk2epVoc.js");return{default:t}},__vite__mapDeps([0,1,2]));u(n,{articleId:e,initialCount:c}).mount(r)}const o=document.getElementById("comment-section-mount");if(o){const{default:n}=await d(async()=>{const{default:t}=await import("./CommentSection.wD9D_RbO.js");return{default:t}},__vite__mapDeps([3,4,2,5,1]));u(n,{articleId:e}).mount(o)}}async function p(){const e=document.getElementById("article-detail");if(!e)return;const c=e.dataset.slug;if(!c)return;const o=f()==="zh"?"zh-CN":"en-US";try{const i=await(await fetch(`/api/v1/articles/${c}`)).json();if(i.code===0&&i.data){const t=i.data;document.title=`${t.title} | Blog`;const m=document.querySelector('meta[name="description"]');m&&m.setAttribute("content",t.summary||t.title);let l=t.content_html||"";if(!l&&t.content){const{renderMarkdown:s}=await d(async()=>{const{renderMarkdown:_}=await import("./markdown.CdwltysG.js");return{renderMarkdown:_}},__vite__mapDeps([6,7,8,5]));l=s(t.content)}e.innerHTML=`
          <header class="article-header">
            <div class="article-meta-top">
              ${t.category?`<a href="/categories/${t.category.slug}" class="article-category">${t.category.name}</a>`:""}
              <span class="article-date">${t.published_at?new Date(t.published_at).toLocaleDateString(o,{year:"numeric",month:"long",day:"numeric"}):""}</span>
            </div>
            <h1 class="article-title">${t.title}</h1>
            ${t.summary?`<p class="article-summary">${t.summary}</p>`:""}
            <div class="article-meta-bottom">
              <span class="meta-item">${t.view_count} ${a("article.views")}</span>
              <span class="meta-item">${t.like_count} ${a("article.likes")}</span>
              <span class="meta-item">${t.reading_time||1} ${a("article.minutes_read")}</span>
            </div>
            <div class="article-tags">
              ${(t.tags||[]).map(s=>`<a href="/tags/${s.slug}" class="article-tag">${s.name}</a>`).join("")}
            </div>
          </header>
          <div class="article-content prose">${l}</div>
          <div class="article-actions">
            <div id="like-button-mount" data-article-id="${t.id}"></div>
          </div>
          <div id="comment-section-mount"></div>
        `,v(t.id,t.like_count||0)}else e.innerHTML=`<div class="article-not-found"><h2>${a("article.not_found")}</h2><p>${a("article.check_link")}</p><a href="/" class="back-link">${a("article.back_home")}</a></div>`}catch{e.innerHTML=`<div class="article-not-found"><p>${a("article.load_error")}</p><a href="/" class="back-link">${a("article.back_home")}</a></div>`}}p();document.addEventListener("locale-changed",()=>p());
