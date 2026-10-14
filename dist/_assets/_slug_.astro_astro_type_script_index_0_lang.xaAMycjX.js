import{t as n,g as v}from"./i18n.Bppg9S7s.js";import{s as g,e as l}from"./escape.DHLiVI85.js";import"./purify.es.Csrj9YNg.js";function y(a){return String(a??"").replace(/[&<>"]/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[e])}async function r(a=1){const e=document.querySelector(".article-list-inner");if(!e)return;const d=document.getElementById("article-list");if(!d)return;const m=d.dataset.tagSlug,u=v()==="zh"?"zh-CN":"en-US";try{const o=await(await fetch(`/api/v1/articles?page=${a}&status=published&tag_slug=${m}`)).json();if(o.code===0&&o.data){const{items:p,total_pages:c}=o.data;if(p.length===0){e.innerHTML=`<p style="text-align:center;color:var(--color-text-tertiary);padding:3rem 0;">${n("page.no_articles_tag")}</p>`;return}e.innerHTML=p.map(t=>`
          <article class="list-card">
            <a href="/articles/${g(t.slug)}" class="list-card-link">
              <div class="list-card-body">
                <div class="list-card-meta">
                  ${t.category?`<span class="list-card-category">${l(t.category.name)}</span>`:""}
                  <span class="list-card-date">${t.published_at?new Date(t.published_at).toLocaleDateString(u,{year:"numeric",month:"long",day:"numeric"}):""}</span>
                </div>
                <h3 class="list-card-title">${l(t.title)}</h3>
                ${t.summary?`<p class="list-card-summary">${l(t.summary)}</p>`:""}
                <div class="list-card-footer">
                  <div class="list-card-tags">
                    ${(t.tags||[]).slice(0,3).map(s=>`<a href="/tags/${g(s.slug)}" class="list-card-tag">${y(s.name)}</a>`).join("")}
                  </div>
                  <span class="list-card-stats">${t.view_count||0} ${n("article.read")}</span>
                </div>
              </div>
            </a>
          </article>
        `).join("");const i=document.getElementById("pagination-mount");if(i&&c>1){let t='<div class="pagination">';a>1&&(t+=`<button class="pag-btn" data-page="${a-1}">${n("page.prev")}</button>`),t+=`<span class="pag-info">${a} / ${c}</span>`,a<c&&(t+=`<button class="pag-btn" data-page="${a+1}">${n("page.next")}</button>`),t+="</div>",i.innerHTML=t,i.querySelectorAll(".pag-btn").forEach(s=>{s.addEventListener("click",()=>{const f=parseInt(s.dataset.page||"1",10);r(f),window.scrollTo({top:0,behavior:"smooth"})})})}}}catch{e.innerHTML=`<p style="text-align:center;color:var(--color-text-tertiary);padding:3rem 0;">${n("common.load_failed")}</p>`}}document.addEventListener("astro:page-load",()=>r());document.addEventListener("locale-changed",()=>r());
