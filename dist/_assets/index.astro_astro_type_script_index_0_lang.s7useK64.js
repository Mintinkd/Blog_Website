import{t as s,getLocale as l}from"./i18n.CQj9Tpoy.js";async function r(){const e=document.getElementById("article-grid");if(!e)return;const n=l()==="zh"?"zh-CN":"en-US";try{const t=await(await fetch("/api/v1/articles?page=1&page_size=6&status=published")).json();if(t.code===0&&t.data){const{items:c}=t.data;if(c.length===0){e.innerHTML=`<p class="empty-text" style="grid-column:1/-1;text-align:center;color:var(--color-text-tertiary);padding:3rem 0;">${s("article.no_articles")}</p>`;return}e.innerHTML=c.map(a=>`
          <article class="article-card">
            <a href="/articles/${a.slug}" class="card-link">
              <div class="card-body">
                <div class="card-meta">
                  ${a.category?`<span class="card-category">${a.category.name}</span>`:""}
                  <span class="card-date">${a.published_at?new Date(a.published_at).toLocaleDateString(n,{year:"numeric",month:"long",day:"numeric"}):""}</span>
                </div>
                <h3 class="card-title">${a.title}</h3>
                <p class="card-summary">${a.summary||""}</p>
                <div class="card-footer">
                  <div class="card-tags">
                    ${(a.tags||[]).slice(0,2).map(i=>`<span class="card-tag">${i.name}</span>`).join("")}
                  </div>
                  <span class="card-read">${a.view_count||0} ${s("article.read")}</span>
                </div>
              </div>
            </a>
          </article>
        `).join("")}}catch{e.innerHTML=`<p class="error-text" style="grid-column:1/-1;text-align:center;color:var(--color-text-tertiary);padding:3rem 0;">${s("article.load_error")}</p>`}}r();document.addEventListener("locale-changed",()=>r());
