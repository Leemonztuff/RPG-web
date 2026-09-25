// Paper Doll 系统：身体（服装/护甲层）与头部分离渲染
// 素材来自 Argentum-tales：4×4 网格，行1=正面(南) 行2=左 行3=右 行4=背面(北)（用户确认的网格朝向）
// 身体帧 320px（步进325，内容 y=0-318，肩线 y=29），头部帧 128px（步进138）。
// 合成后裁掉顶部 38px 空白：最终画布 320×382，头部与身体保持原始像素比例，脚底仍落在画布底边。
// 渲染管线兼容：合成结果通过 frame.source 直接喂给 drawHeroSprite / drawMonsterSprite。
const PaperDoll = (() => {
    // ---------- 几何常量 ----------
    const BODY_FRAME = 320;      // 身体帧原始尺寸
    const CONTENT_TOP = 38;      // 合成后顶部透明区：头部可见内容从 y=38 开始
    const BODY_OFFSET_Y = 100 - CONTENT_TOP; // 裁剪后身体下移量；沿用已标定的肩线/头部对位
    const FRAME_H = 382;         // 裁掉顶部空白后的可见合成高度（身体320 + 头部向上延伸62）
    const HEAD_FRAME = 128;      // 头部素材帧尺寸
    const HEAD_SCALE = 1.0;      // 头部原始尺寸：发型完整盖住身体光头（缩放会在太阳穴露出头皮）
    const HEAD_BOTTOM_Y = 132 - CONTENT_TOP; // 裁剪后的头部底边，仍落在身体肩线
    const RENDER_HEIGHT = 112;   // 玩家可见角色高度；不再把顶部透明区计入屏幕尺寸
    const NPC_RENDER_HEIGHT = 112; // NPC与玩家统一可见高度（同一张320px合成帧、同一比例）
    const BODY_STRIDE = 325;     // 4×320 帧间空隙 5px
    const HEAD_STRIDE = 138;     // 4×128 帧间空隙 10px

    // 方向：素材行 → 游戏方向名（行1=南/正面，行2=左，行3=右，行4=北/背面）
    const DIRS = ['front', 'left', 'right', 'back'];
    // 游戏斜向 → 最近的素材主方向（素材只有4向）
    const DIR_FALLBACK = { frontLeft: 'front', frontRight: 'front', backLeft: 'back', backRight: 'back' };

    // ---------- 资源清单 ----------
    const HEADS = ['hair01', 'hair02', 'hair03', 'hair04', 'hair05', 'hair06', 'hair07'];
    const NPC_BODIES = ['Npc-00', 'Npc-01', 'Npc-02', 'Npc-03', 'Npc-04', 'Npc-05', 'Npc-06', 'Npc-07', 'Npc-08', 'Npc-09', 'Npc-10'];
    // 套装 → 护甲图集（16选10，后续按套装主题替换）
    const SET_ARMOR = {
        tals_set: 'frame_054',   // frame_004 仓库中不存在，改用同风格护甲
        immortal_king: 'frame_000',
        shadow_dancer: 'frame_013',
        natalya: 'frame_010',
        griswold: 'frame_001',
        trang_oul: 'frame_052',
        aldur: 'frame_007',
        mavina: 'frame_009',
        sigon: 'frame_002',
        abyss_conqueror: 'frame_046'
    };
    // 起始服装（初始身体）
    const DEFAULT_CLOTHES = 'clothes_072';
    const PLAYER_BODY = 'body_base';

    // ---------- 运行时状态 ----------
    const images = new Map();          // key → Image（加载完成）
    const compCache = new Map();       // 组合key → 合成canvas（LRU上限）
    const COMP_CACHE_MAX = 40;     // 每张合成画布约450KB，40张≈18MB上限
    const randomPick = new Map();      // NPC → { body, head }（按名字稳定）
    // 运行期诊断：控制台执行 PaperDoll._diag() 可确认合成帧是否真的被生成/使用
    const diag = { playerCalls: 0, playerReady: 0, playerMissing: 0, npcCalls: 0, npcReady: 0, last: null };

    function stableHash(str) {
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
        return h >>> 0;
    }

    function getImage(key) {
        if (!key) return null;
        const img = images.get(key);
        return (img && img.complete && img.naturalWidth > 0) ? img : null;
    }

    function loadKey(key, url) {
        const img = new Image();
        img.onload = () => { images.set(key, img); };
        img.src = url;
    }

    // ---------- 加载入口 ----------
    function preloadCore() {
        loadKey('body_base', 'art/paperdoll/bodies/body_base.webp');
        loadKey('clothes_' + DEFAULT_CLOTHES, 'art/paperdoll/clothes/' + DEFAULT_CLOTHES + '.webp');
        HEADS.forEach(h => loadKey('head_' + h, 'art/paperdoll/heads/' + h + '_head_spritesheet.png'));
        NPC_BODIES.forEach(n => loadKey('body_' + n, 'art/paperdoll/bodies/' + n + '.webp'));
        Object.values(SET_ARMOR).forEach(a => loadKey('armor_' + a, 'art/paperdoll/armor/' + a + '.webp'));
    }

    function preloadClothes(name) {
        if (!name) return;
        const key = 'clothes_' + name;
        if (images.has(key)) return;
        if (!loadKey._pending) loadKey._pending = new Map();
        if (loadKey._pending.has(name)) return;
        loadKey._pending.set(name, true);
        const img = new Image();
        img.onload = () => { images.set(key, img); loadKey._pending.delete(name); };
        img.onerror = () => { loadKey._pending.delete(name); };
        img.src = 'art/paperdoll/clothes/' + name + '.webp';
    }

    // ---------- 玩家变体选择 ----------
    // 2件及以上同套装 → 护甲身体；否则初始服装
    function playerBodyKey() {
        const sets = (typeof player !== 'undefined' && player.equippedSets) || {};
        let best = null, bestCount = 1;
        for (const setId in sets) {
            if (sets[setId] >= 2 && sets[setId] > bestCount && SET_ARMOR[setId]) {
                best = setId; bestCount = sets[setId];
            }
        }
        if (best) return 'armor_' + SET_ARMOR[best];
        return 'clothes_' + DEFAULT_CLOTHES;
    }

    function playerHeadKey() {
        return (typeof player !== 'undefined' && player.headId) ? 'head_' + player.headId : 'head_hair01';
    }

    // ---------- NPC 稳定随机 ----------
    function npcLook(name) {
        if (!randomPick.has(name)) {
            const h = stableHash(name);
            randomPick.set(name, {
                body: NPC_BODIES[h % NPC_BODIES.length],
                head: HEADS[(h >> 4) % HEADS.length]
            });
        }
        return randomPick.get(name);
    }

    // ---------- 合成 ----------
    function drawLayer(ctx, img, row, frameIndex, dx, dy, scale) {
        const stride = scale === 1 ? BODY_STRIDE : HEAD_STRIDE;
        ctx.drawImage(
            img,
            frameIndex * stride, row * stride,
            scale === 1 ? BODY_FRAME : HEAD_FRAME, scale === 1 ? BODY_FRAME : HEAD_FRAME,
            dx, dy,
            scale === 1 ? BODY_FRAME : Math.round(HEAD_FRAME * scale), Math.round(HEAD_FRAME * scale)
        );
    }

    // 合成 帧级 canvas：头(下层已在头发后) + 身体层
    function compose(bodyImg, headImg, row, frameIndex, flipX) {
        const cv = document.createElement('canvas');
        cv.width = BODY_FRAME;
        cv.height = FRAME_H;
        const ctx = cv.getContext('2d');
        // 身体（保持原始320px尺寸，脚底贴近画布底边）
        drawLayer(ctx, bodyImg, row, frameIndex, 0, BODY_OFFSET_Y, 1);
        // 头部（原始尺寸，底边落在肩线上，盖住身体自带的光头）
        if (headImg) {
            const hs = Math.round(HEAD_FRAME * HEAD_SCALE);
            ctx.drawImage(headImg, frameIndex * HEAD_STRIDE, row * HEAD_STRIDE, HEAD_FRAME, HEAD_FRAME,
                Math.round((BODY_FRAME - hs) / 2), HEAD_BOTTOM_Y - hs, hs, hs);
        }
        if (flipX) {
            const flipped = document.createElement('canvas');
            flipped.width = cv.width; flipped.height = cv.height;
            const fctx = flipped.getContext('2d');
            fctx.translate(cv.width, 0);
            fctx.scale(-1, 1);
            fctx.drawImage(cv, 0, 0);
            return flipped;
        }
        return cv;
    }

    function cachePut(key, canvas) {
        if (compCache.size >= COMP_CACHE_MAX) {
            const oldest = compCache.keys().next().value;
            const old = compCache.get(oldest);
            if (old) { old.width = 0; old.height = 0; }
            compCache.delete(oldest);
        }
        compCache.set(key, canvas);
        return canvas;
    }

    /**
     * 获取合成帧（返回 null 表示素材未就绪，调用方回退原渲染）
     * @param {string} bodyKey images key：body_base / body_Npc-xx / armor_frame_xxx / clothes_xxx
     * @param {string} headKey  'head_hair01' 等
     * @param {string} direction front/back/left/right/frontLeft...
     * @param {number} frameIndex 0-3 动画帧
     * @param {boolean} flipX 需要镜像时
     */
    function getFrame(bodyKey, headKey, direction, frameIndex, flipX) {
        const bodyImg = getImage(bodyKey);
        if (!bodyImg) return null;
        const headImg = getImage(headKey);
        const dir = DIR_FALLBACK[direction] || (DIRS.includes(direction) ? direction : 'front');
        const row = DIRS.indexOf(dir);
        const key = bodyKey + '|' + headKey + '|' + row + '|' + frameIndex + '|' + (flipX ? 1 : 0);
        const cached = compCache.get(key);
        if (cached) return cached;
        return cachePut(key, compose(bodyImg, headImg, row, frameIndex, flipX));
    }

    // 玩家帧入口：返回 { source, x:0, y:0, width, height, paperDoll } 与 drawHeroSprite 兼容
    function playerFrame(direction, frameIndex, flipX) {
        diag.playerCalls++;
        const bodyKey = playerBodyKey(), headKey = playerHeadKey();
        const cv = getFrame(bodyKey, headKey, direction, frameIndex, flipX);
        if (!cv) {
            diag.playerMissing++;
            diag.last = { bodyKey, headKey, ready: false };
            return null;
        }
        diag.playerReady++;
        diag.last = { bodyKey, headKey, ready: true, width: cv.width, height: cv.height, direction, frameIndex };
        if (diag.playerReady === 1) console.info('[PaperDoll] 玩家合成帧已生成', diag.last);
        return { source: cv, x: 0, y: 0, width: cv.width, height: cv.height, paperDoll: true };
    }

    // NPC 帧入口（附 contentBounds 兼容 EnvironmentArt 渲染分支）
    function npcFrame(name, direction, frameIndex, flipX) {
        diag.npcCalls++;
        const look = npcLook(name);
        const cv = getFrame('body_' + look.body, 'head_' + look.head, direction, frameIndex, flipX);
        if (!cv) return null;
        diag.npcReady++;
        return { source: cv, x: 0, y: 0, width: cv.width, height: cv.height,
                 contentBounds: { sx: 0, sy: 0, sw: cv.width, sh: cv.height } };
    }

        // 核心资源立即开始加载（就绪前调用方回退原图集）
        preloadCore();

    return {
        preloadCore,
        preloadClothes,
        playerFrame,
        npcFrame,
        playerBodyKey,
        RENDER_HEIGHT,
        NPC_RENDER_HEIGHT,
        SET_ARMOR,
        HEADS,
        NPC_BODIES,
        DEFAULT_CLOTHES,
        _cacheStats: () => ({ entries: compCache.size, max: COMP_CACHE_MAX }),
        _diag: () => ({ ...diag, cache: compCache.size, images: images.size })
    };
})();
