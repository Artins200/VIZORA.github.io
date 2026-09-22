# BlockWorld

Оригинальный воксельный sandbox на **Electron + Three.js**.

> **Не связан** с Minecraft®, Mojang Studios или Microsoft.  
> Название, блоки, текстуры и механики — полностью свои.  
> Никаких ассетов, звуков, скинов или названий из Minecraft.

## Скрин / что умеет

- Процедурный мир: холмы, пещеры, озёра, пляжи, снег, деревья, руда
- Чанки 16×96×16 с подгрузкой вокруг игрока
- Face-culling + texture atlas + лимит генерации/мешей за кадр → стабильный FPS
- Ломать / ставить блоки, хотбар 1–9
- Физика AABB, вода, полёт (`F`)
- Туман как дешёвый LOD, настройка дальности (4–12 чанков)

## Быстрый старт (браузер)

```bash
cd blockworld
npm install
npm run web
# откройте http://localhost:4173
```

## Electron (десктоп)

```bash
cd blockworld
npm install
# если electron не скачался (сеть/SSL):
#   npm install electron --save-dev
npm start
```

Файлы Electron уже готовы: `main.js`, `preload.js`, `package.json`.

## Управление

| Клавиша | Действие |
|---------|----------|
| WASD | Ходьба |
| Space | Прыжок / всплытие |
| Shift | Бег / погружение |
| ЛКМ | Ломать блок |
| ПКМ | Ставить блок |
| 1–9 / колёсико | Слот хотбара |
| F | Режим полёта |
| F3 | FPS / координаты |
| Esc | Меню паузы |

## Оптимизация

- `antialias: false`, pixel ratio ≤ 1.5
- Не больше 3 генераций и 2 мешей чанков за кадр
- Выгрузка далёких чанков
- Один shared atlas на все блоки (меньше switch material)
- Туман обрезает дальнюю геометрию визуально
- Без shadow maps (освещение hemisphere + directional)

## Структура

```
blockworld/
  main.js          Electron main process
  preload.js       Безопасный bridge
  index.html       UI + canvas
  server.js        Локальный веб-сервер
  src/
    main.js        Игровой цикл
    world.js       Чанки / raycast
    chunk.js       Генерация + mesh
    player.js      FPS-контроллер
    blocks.js      Типы блоков + procedural textures
    atlas.js       Texture atlas
    noise.js       Perlin / FBM
```

## Лицензия

MIT. Сторонние ассеты Minecraft **не используются**.
