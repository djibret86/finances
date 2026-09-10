/* Service worker — rend l'application utilisable sans connexion.
   Pour publier une mise à jour, incrémente CACHE ci-dessous (finances-v2, v3...)
   ET APP_VERSION dans index.html : les deux doivent rester d'accord. */
var CACHE = 'finances-v8';
var ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

/* addAll() passait par le cache HTTP du navigateur : GitHub Pages sert index.html
   avec max-age=600, donc un service worker tout neuf pouvait remettre en cache
   l'ANCIENNE page — et le mode « cache d'abord » la servait ensuite indefiniment.
   cache:'reload' force le reseau et coupe ce piege. */
self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE).then(function(c){
      return Promise.all(ASSETS.map(function(u){
        return fetch(new Request(u, { cache: 'reload' })).then(function(r){
          if(r && r.ok) return c.put(u, r);
        }).catch(function(){});
      }));
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== CACHE; })
                             .map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e){
  if(e.request.method !== 'GET') return;

  /* La page elle-meme : reseau d'abord, cache en secours. C'est ce qui fait
     qu'une mise a jour publiee arrive des la prochaine ouverture au lieu
     d'attendre un changement de version du service worker. */
  var accept = e.request.headers.get('accept') || '';
  if(e.request.mode === 'navigate' || accept.indexOf('text/html') !== -1){
    e.respondWith(
      fetch(e.request).then(function(res){
        if(res && res.ok){
          var copy = res.clone();
          caches.open(CACHE).then(function(c){ c.put('./index.html', copy); });
        }
        return res;
      }).catch(function(){
        return caches.match('./index.html').then(function(hit){
          return hit || caches.match('./');
        });
      })
    );
    return;
  }

  /* Le reste (icones, manifeste) ne bouge pas : cache d'abord, c'est plus rapide. */
  e.respondWith(
    caches.match(e.request).then(function(hit){
      if(hit) return hit;
      return fetch(e.request).then(function(res){
        if(res && res.status === 200 && res.type === 'basic'){
          var copy = res.clone();
          caches.open(CACHE).then(function(c){ c.put(e.request, copy); });
        }
        return res;
      });
    })
  );
});
