import{t as e,g as v}from"./i18n.Bppg9S7s.js";import{s as $,e as l}from"./escape.DHLiVI85.js";import"./purify.es.Csrj9YNg.js";async function r(a=1){const s=document.querySelector(".article-list-inner");if(!s)return;const d=document.getElementById("article-list");if(!d)return;const g=d.dataset.categorySlug,m=v()==="zh"?"zh-CN":"en-US";try{const o=await(await fetch(`/api/v1/articles?page=${a}&status=published&category_slug=${g}`)).json();if(o.code===0&&o.data){const{items:p,total_pages:c}=o.data;if(p.length===0){s.innerHTML=`<p style="text-align:center;color:var(--color-text-tertiary);padding:3rem 0;">${e("page.no_articles_category")}</p>`;return}s.innerHTML=p.map(t=>`
          <article class="list-card">
            <a href="/articles/${$(t.slug)}" class="list-card-link">
              <div class="list-card-body">
                <div class="list-card-meta">
                  <span class="list-card-date">${t.published_at?new Date(t.published_at).toLocaleDateString(m,{year:"numeric",month:"long",day:"numeric"}):""}</span>
                </div>
                <h3 class="list-card-title">${l(t.title)}</h3>
                ${t.summary?`<p class="list-card-summary">${l(t.summary)}</p>`:""}
                <div class="list-card-footer">
                  <div class="list-card-tags">
                    ${(t.tags||[]).slice(0,3).map(n=>`<span class="list-card-tag">${l(n.name)}</span>`).join("")}
                  </div>
                  <span class="list-card-stats">${t.view_count||0} ${e("article.read")}</span>
                </div>
              </div>
            </a>
          </article>
        `).join("");const i=document.getElementById("pagination-mount");if(i&&c>1){let t='<div class="pagination">';a>1&&(t+=`<button class="pag-btn" data-page="${a-1}">${e("page.prev")}</button>`),t+=`<span class="pag-info">${a} / ${c}</span>`,a<c&&(t+=`<button class="pag-btn" data-page="${a+1}">${e("page.next")}</button>`),t+="</div>",i.innerHTML=t,i.querySelectorAll(".pag-btn").forEach(n=>{n.addEventListener("click",()=>{const y=parseInt(n.dataset.page||"1",10);r(y),window.scrollTo({top:0,behavior:"smooth"})})})}}}catch{s.innerHTML=`<p style="text-align:center;color:var(--color-text-tertiary);padding:3rem 0;">${e("common.load_failed")}</p>`}}document.addEventListener("astro:page-load",()=>r());document.addEventListener("locale-changed",()=>r());
