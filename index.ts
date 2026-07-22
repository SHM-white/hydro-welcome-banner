import path from 'path';
import yaml from 'js-yaml';
import {
    Context, Handler, param, post, PRIV, StorageModel, SystemModel,
    Types, UserModel, ValidationError,
} from 'hydrooj';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
// The whole banner configuration lives in a single system-settings document so
// the visual editor can read/write it atomically without a bespoke collection.
const CONFIG_KEY = 'welcomeBanner.config';

interface BannerItem {
    id: string;
    image: string;      // URL used on the homepage — usually /file/<uid>/<name>
    link: string;       // where the slide points to ('' = not clickable)
    title: string;      // optional caption shown over the slide
    alt: string;        // accessibility text
    newTab: boolean;    // open the link in a new tab
    enabled: boolean;   // hide without deleting
    // When the image was uploaded as a user attachment we remember where so the
    // underlying file can optionally be removed together with the slide.
    file?: { uid: number; name: string };
}

interface BannerConfig {
    enabled: boolean;
    banners: BannerItem[];
    autoPlay: boolean;
    interval: number;
    width: number;
    height: number;
    borderRadius: number;
    objectFit: 'contain' | 'cover';
    blurBackground: boolean;
    showDots: boolean;
    showArrows: boolean;
    transition: 'fade' | 'slide';
    hoverZoom: boolean;
    hoverZoomScale: number;
}

const DEFAULT_CONFIG: BannerConfig = {
    enabled: true,
    banners: [],
    autoPlay: true,
    interval: 5000,
    width: 1200,
    height: 300,
    borderRadius: 12,
    objectFit: 'contain',
    blurBackground: true,
    showDots: true,
    showArrows: false,
    transition: 'fade',
    hoverZoom: true,
    hoverZoomScale: 1.05,
};

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif', '.bmp'];
const MAX_UPLOAD = 16 * 1024 * 1024; // 16 MiB

let idSeq = 0;
function genId() {
    idSeq = (idSeq + 1) % 100000;
    return `b${Date.now().toString(36)}${idSeq.toString(36)}`;
}

function normalizeItem(raw: any): BannerItem {
    return {
        id: raw?.id || genId(),
        image: String(raw?.image || ''),
        link: String(raw?.link || ''),
        title: String(raw?.title || ''),
        alt: String(raw?.alt || ''),
        newTab: raw?.newTab !== false,
        enabled: raw?.enabled !== false,
        file: raw?.file && typeof raw.file === 'object'
            ? { uid: +raw.file.uid, name: String(raw.file.name) }
            : undefined,
    };
}

// Read the config, applying defaults and a one-time migration from the old
// `welcomeBanner.banners` JSON-string setting shipped by v1 of this plugin.
function getConfig(): BannerConfig {
    const raw = SystemModel.get(CONFIG_KEY);
    if (raw && typeof raw === 'object') {
        const cfg = { ...DEFAULT_CONFIG, ...raw };
        cfg.banners = Array.isArray(raw.banners) ? raw.banners.map(normalizeItem) : [];
        return cfg;
    }
    const cfg = { ...DEFAULT_CONFIG, banners: [] as BannerItem[] };
    const legacy = SystemModel.get('welcomeBanner.banners' as any);
    if (legacy) {
        try {
            const arr = typeof legacy === 'string' ? JSON.parse(legacy) : legacy;
            if (Array.isArray(arr)) cfg.banners = arr.map(normalizeItem);
        } catch { /* ignore malformed legacy config */ }
    }
    const legacyAuto = SystemModel.get('welcomeBanner.autoPlay' as any);
    if (typeof legacyAuto === 'boolean') cfg.autoPlay = legacyAuto;
    const legacyInterval = SystemModel.get('welcomeBanner.interval' as any);
    if (typeof legacyInterval === 'number') cfg.interval = legacyInterval;
    return cfg;
}

async function saveConfig(cfg: BannerConfig) {
    await SystemModel.set(CONFIG_KEY, cfg as any);
}

function clampInt(v: number, min: number, max: number, fallback: number) {
    if (!Number.isFinite(v)) return fallback;
    return Math.min(Math.max(Math.round(v), min), max);
}

// Does the homepage YAML already contain a `banner` section? On current Hydro a
// section is a top-level key of a column (e.g. `bulletin: true`), so `banner`
// must be a column key for HomeHandler.getBanner to run.
function homepageHasBanner(): boolean {
    try {
        const raw = SystemModel.get('hydrooj.homepage' as any);
        const doc = yaml.load(raw) as any;
        if (!Array.isArray(doc)) return false;
        return doc.some((col) => col && Object.prototype.hasOwnProperty.call(col, 'banner'));
    } catch {
        return false;
    }
}

function sanitizeFilename(name: string) {
    const ext = path.extname(name).toLowerCase();
    const base = path.basename(name, path.extname(name))
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 40) || 'image';
    return { base, ext };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
class BannerManageHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
    }

    async get() {
        const config = getConfig();
        this.response.template = 'manage_banner.html';
        this.response.body = { config, uid: this.user._id, hasHomepageSection: homepageHasBanner() };
    }

    // operation=add_homepage — patch the homepage YAML so the `banner` section
    // renders, saving the admin from hand-editing hydrooj.homepage.
    async postAddHomepage() {
        if (!homepageHasBanner()) {
            const raw = SystemModel.get('hydrooj.homepage' as any);
            let doc: any;
            try {
                doc = yaml.load(raw);
            } catch { doc = null; }
            if (Array.isArray(doc) && doc.length) {
                // Rebuild the widest column with `banner` first so it renders at
                // the very top of the homepage, keeping width/other sections.
                let idx = 0;
                let best = -1;
                doc.forEach((c: any, i: number) => {
                    const w = +(c?.width || 0);
                    if (w > best) { best = w; idx = i; }
                });
                const col = doc[idx] || {};
                const rebuilt: any = {};
                if ('width' in col) rebuilt.width = col.width;
                rebuilt.banner = true;
                for (const k of Object.keys(col)) {
                    if (k !== 'width' && k !== 'banner') rebuilt[k] = col[k];
                }
                doc[idx] = rebuilt;
                await SystemModel.set('hydrooj.homepage' as any, yaml.dump(doc));
            }
        }
        this.response.redirect = this.url('manage_banner');
    }

    // operation=upload — store the image as one of the current admin's file
    // attachments and use the returned /file/<uid>/<name> URL as the slide image.
    @param('link', Types.String, true)
    @param('title', Types.String, true)
    @param('alt', Types.String, true)
    async postUpload(domainId: string, link = '', title = '', alt = '') {
        const file = this.request.files?.file;
        if (!file) throw new ValidationError('file');
        if (file.size > MAX_UPLOAD) throw new ValidationError('file');
        const { base, ext } = sanitizeFilename(file.originalFilename || 'image');
        if (!IMAGE_EXTS.includes(ext)) throw new ValidationError('file');
        // Unique name so re-uploading the same file never collides.
        const filename = `banner_${base}_${Date.now().toString(36)}${ext}`;
        const target = `user/${this.user._id}/${filename}`;
        await StorageModel.put(target, file.filepath, this.user._id);
        const meta = await StorageModel.getMeta(target);
        // Register it in the user's file list so it shows up in the normal file
        // manager and counts against quota, mirroring core's upload behaviour.
        const files = this.user._files || [];
        files.push({
            _id: filename,
            name: filename,
            size: meta?.size || file.size,
            etag: meta?.etag || '',
            lastModified: meta?.lastModified || new Date(),
        } as any);
        await UserModel.setById(this.user._id, { _files: files });

        const config = getConfig();
        config.banners.push(normalizeItem({
            image: `/file/${this.user._id}/${filename}`,
            link, title, alt,
            file: { uid: this.user._id, name: filename },
        }));
        await saveConfig(config);
        this.response.redirect = this.url('manage_banner');
    }

    // operation=add_url — add a slide that points at an external image URL.
    @param('image', Types.String)
    @param('link', Types.String, true)
    @param('title', Types.String, true)
    @param('alt', Types.String, true)
    async postAddUrl(domainId: string, image: string, link = '', title = '', alt = '') {
        if (!image.trim()) throw new ValidationError('image');
        const config = getConfig();
        config.banners.push(normalizeItem({
            image: image.trim(), link, title, alt,
        }));
        await saveConfig(config);
        this.response.redirect = this.url('manage_banner');
    }

    // operation=update — edit a single slide's metadata.
    @param('id', Types.String)
    @param('link', Types.String, true)
    @param('title', Types.String, true)
    @param('alt', Types.String, true)
    @param('newTab', Types.Boolean)
    @param('enabled', Types.Boolean)
    async postUpdate(
        domainId: string, id: string, link = '', title = '', alt = '',
        newTab = false, enabled = false,
    ) {
        const config = getConfig();
        const item = config.banners.find((b) => b.id === id);
        if (!item) throw new ValidationError('id');
        item.link = link;
        item.title = title;
        item.alt = alt;
        item.newTab = newTab;
        item.enabled = enabled;
        await saveConfig(config);
        this.response.redirect = this.url('manage_banner');
    }

    // operation=toggle — quick enable/disable without opening the editor.
    @param('id', Types.String)
    async postToggle(domainId: string, id: string) {
        const config = getConfig();
        const item = config.banners.find((b) => b.id === id);
        if (!item) throw new ValidationError('id');
        item.enabled = !item.enabled;
        await saveConfig(config);
        this.response.redirect = this.url('manage_banner');
    }

    // operation=move — reorder a slide up (dir=-1) or down (dir=1).
    @param('id', Types.String)
    @param('dir', Types.Int)
    async postMove(domainId: string, id: string, dir: number) {
        const config = getConfig();
        const i = config.banners.findIndex((b) => b.id === id);
        if (i < 0) throw new ValidationError('id');
        const j = i + (dir < 0 ? -1 : 1);
        if (j < 0 || j >= config.banners.length) {
            this.response.redirect = this.url('manage_banner');
            return;
        }
        [config.banners[i], config.banners[j]] = [config.banners[j], config.banners[i]];
        await saveConfig(config);
        this.response.redirect = this.url('manage_banner');
    }

    // operation=delete — remove a slide, and its backing attachment when asked.
    @param('id', Types.String)
    @param('deleteFile', Types.Boolean)
    async postDelete(domainId: string, id: string, deleteFile = false) {
        const config = getConfig();
        const item = config.banners.find((b) => b.id === id);
        if (!item) throw new ValidationError('id');
        config.banners = config.banners.filter((b) => b.id !== id);
        await saveConfig(config);
        if (deleteFile && item.file && item.file.uid === this.user._id) {
            try {
                await StorageModel.del([`user/${item.file.uid}/${item.file.name}`], this.user._id);
                const files = (this.user._files || []).filter((f: any) => f.name !== item.file!.name);
                await UserModel.setById(this.user._id, { _files: files });
            } catch { /* attachment already gone — ignore */ }
        }
        this.response.redirect = this.url('manage_banner');
    }

    // operation=settings — save the global appearance / carousel options.
    @post('enabled', Types.Boolean)
    @post('autoPlay', Types.Boolean)
    @post('interval', Types.Int, true)
    @post('width', Types.Int, true)
    @post('height', Types.Int, true)
    @post('borderRadius', Types.Int, true)
    @post('objectFit', Types.String, true)
    @post('blurBackground', Types.Boolean)
    @post('showDots', Types.Boolean)
    @post('showArrows', Types.Boolean)
    @post('transition', Types.String, true)
    @post('hoverZoom', Types.Boolean)
    @post('hoverZoomScale', Types.Float, true)
    async postSettings(
        domainId: string, enabled = false, autoPlay = false, interval = 5000,
        width = 1200, height = 300, borderRadius = 12, objectFit = 'contain',
        blurBackground = false, showDots = false, showArrows = false,
        transition = 'fade', hoverZoom = false, hoverZoomScale = 1.05,
    ) {
        const config = getConfig();
        config.enabled = enabled;
        config.autoPlay = autoPlay;
        config.interval = clampInt(interval, 1000, 60000, 5000);
        config.width = clampInt(width, 200, 4000, 1200);
        config.height = clampInt(height, 60, 2000, 300);
        config.borderRadius = clampInt(borderRadius, 0, 200, 12);
        config.objectFit = objectFit === 'cover' ? 'cover' : 'contain';
        config.blurBackground = blurBackground;
        config.showDots = showDots;
        config.showArrows = showArrows;
        config.transition = transition === 'slide' ? 'slide' : 'fade';
        config.hoverZoom = hoverZoom;
        config.hoverZoomScale = Math.min(Math.max(Number(hoverZoomScale) || 1.05, 1), 2);
        await saveConfig(config);
        this.response.redirect = this.url('manage_banner');
    }
}

// ---------------------------------------------------------------------------
// Homepage integration
// ---------------------------------------------------------------------------
export function apply(ctx: Context) {
    ctx.Route('manage_banner', '/manage/banner', BannerManageHandler);
    ctx.injectUI('ControlPanel', 'manage_banner', { icon: 'flag' });

    // Attach getBanner to the homepage handler so the `banner` section renders.
    ctx.on('handler/create', (thisArg: any) => {
        if (thisArg.constructor.name !== 'HomeHandler') return;
        thisArg.getBanner = async function getBanner(domainId: string, limit = 20) {
            const config = getConfig();
            const banners = config.enabled
                ? config.banners.filter((b) => b.enabled && b.image).slice(0, limit)
                : [];
            return [{ ...config, banners }];
        };
    });

    ctx.i18n.load('zh', {
        manage_banner: '封面横幅',
        'Banner Management': '封面横幅管理',
        'Welcome Banner': '欢迎横幅',
        'Add / upload banner slides, reorder them and tune the carousel — changes take effect on the homepage immediately.':
            '上传 / 添加横幅图片、调整顺序并配置轮播效果，保存后主页即时生效。',
        'Upload image': '上传图片',
        'Upload as attachment': '作为附件上传',
        'The image is stored in your user attachments; the returned /file link is used as the slide.':
            '图片将作为你的用户附件保存，返回的 /file 链接会用作横幅图片。',
        'Add by URL': '通过链接添加',
        'Image URL': '图片链接',
        'Choose file': '选择文件',
        'Link (optional)': '跳转链接（可选）',
        'Title (optional)': '标题（可选）',
        'Alt text (optional)': '替代文本（可选）',
        Slides: '横幅列表',
        'No banner slides yet. Upload an image or add one by URL above.': '暂无横幅。请在上方上传图片或通过链接添加。',
        'Move up': '上移',
        'Move down': '下移',
        Enable: '启用',
        Disable: '停用',
        Enabled: '已启用',
        Disabled: '已停用',
        'Open in new tab': '在新标签页打开',
        'Delete slide': '删除横幅',
        'Also delete the uploaded file': '同时删除已上传的附件',
        'Delete this banner slide?': '确定删除这个横幅吗？',
        'Live Preview': '实时预览',
        'Global Settings': '全局设置',
        'Enable banner on homepage': '在主页启用横幅',
        'Auto play': '自动播放',
        'Interval (ms)': '轮播间隔（毫秒）',
        'Width (px)': '宽度（像素）',
        'Height (px)': '高度（像素）',
        'Border radius (px)': '圆角（像素）',
        'Image fit': '图片填充方式',
        contain: '完整显示 (contain)',
        cover: '铺满裁剪 (cover)',
        'Blurred background fill': '模糊背景填充',
        'Show dot indicators': '显示圆点指示器',
        'Show arrows': '显示左右箭头',
        'Transition effect': '切换效果',
        fade: '淡入淡出',
        slide: '滑动',
        'Enable hover zoom effect': '启用悬停放大效果',
        'Hover zoom scale': '悬停放大倍数',
        'Save settings': '保存设置',
        'Homepage setup': '主页配置',
        'To display the banner you must include a `banner` section in the homepage config.':
            '要显示横幅，需要在主页配置中加入 `banner` 区块。',
        'Add `banner` to homepage now': '一键将 `banner` 加入主页',
        'Banner section is already present in the homepage config.': '主页配置中已包含 `banner` 区块。',
        'banner slides': '张横幅',
    });
    ctx.i18n.load('en', {
        manage_banner: 'Banner Management',
    });
}
