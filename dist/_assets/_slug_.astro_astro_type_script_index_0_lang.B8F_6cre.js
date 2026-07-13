import{t as e,getLocale as y}from"./i18n.CQj9Tpoy.js";async function o(a=1){const s=document.querySelector(".article-list-inner");if(!s)return;const r=document.getElementById("article-list");if(!r)return;const p=r.dataset.categorySlug,g=y()==="zh"?"zh-CN":"en-US";try{const c=await(await fetch(`/api/v1/articles?page=${a}&status=published&category_slug=${p}`)).json();if(c.code===0&&c.data){const{items:d,total_pages:i}=c.data;if(d.length===0){s.innerHTML=`<p style="text-align:center;color:var(--color-text-tertiary);padding:3rem 0;">${e("page.no_articles_category")}</p>`;return}s.innerHTML=d.map(t=>`
          <article class="list-card">
            <a href="/articles/${t.slug}" class="list-card-link">
              <div class="list-card-body">
                <div class="list-card-meta">
                  <span class="list-card-date">${t.published_at?new Date(t.published_at).toLocaleDateString(g,{year:"numeric",month:"long",day:"numeric"}):""}</span>
                </div>
                <h3 class="list-card-title">${t.title}</h3>
                ${t.summary?`<p class="list-card-summary">${t.summary}</p>`:""}
                <div class="list-card-footer">
                  <div class="list-card-tags">
                    ${(t.tags||[]).slice(0,3).map(n=>`<span class="list-card-tag">${n.name}</span>`).join("")}
                  </div>
                  <span class="list-card-stats">${t.view_count||0} ${e("article.read")}</span>
                </div>
              </div>
            </a>
          </article>
        `).join("");const l=document.getElementById("pagination-mount");if(l&&i>1){let t='<div class="pagination">';a>1&&(t+=`<button class="pag-btn" data-page="${a-1}">${e("page.prev")}</button>`),t+=`<span class="pag-info">${a} / ${i}</span>`,a<i&&(t+=`<button class="pag-btn" data-page="${a+1}">${e("page.next")}</button>`),t+="</div>",l.innerHTML=t,l.querySelectorAll(".pag-btn").forEach(n=>{n.addEventListener("click",()=>{const m=parseInt(n.dataset.page||"1",10);o(m),window.scrollTo({top:0,behavior:"smooth"})})})}}}catch{s.innerHTML=`<p style="text-align:center;color:var(--color-text-tertiary);padding:3rem 0;">${e("common.load_failed")}</p>`}}o();document.addEventListener("locale-changed",()=>o());
