// content.ts - 游戏资源管理器
// 使用静态类模式集中管理所有游戏资源（纹理、精灵表、字体）
// 类似于 XNA/MonoGame 的 ContentManager 模式：
//   所有资源在初始化时一次性加载，之后通过静态成员全局访问

import { vec2 } from "wgpu-matrix";
import { Quad } from "../utils/quad";
import { Rect } from "../utils/rect";
import { Sprite } from "../core/sprite";
import { SpriteFont } from "../core/sprite-font";
import { Texture } from "../core/texture";

export class Content {

    // 位图字体（SpriteFont）：将每个字符预渲染到纹理图集上
    // 通过查找字符的纹理坐标来渲染文字，比矢量字体在 GPU 上更高效
    public static spriteFont: SpriteFont;

    // 各个独立的纹理资源
    public static playerTexture: Texture;      // 玩家飞船纹理
    public static ufoRedTexture: Texture;       // 红色 UFO 敌人纹理
    public static uvTexture: Texture;           // UV 测试纹理（用于调试纹理映射）
    public static spriteSheet: Texture;         // 精灵图表集：一张大纹理包含多个小精灵
    public static backgroundTexture: Texture;   // 背景纹理
    public static explosionTexture: Texture;    // 爆炸特效纹理
    public static iceTexture: Texture;          // 冰面纹理

    // 精灵字典：通过名称索引精灵表中的各个子精灵
    // 键为精灵名称（来自 XML 定义），值为对应的 Sprite 对象
    public static sprites: { [id: string]: Sprite } = {};

    // 初始化所有游戏资源
    // 必须在 Engine 初始化（获取 GPUDevice）之后调用
    public static async initialize(device: GPUDevice) {
        // 加载独立纹理文件
        // Texture.createTextureFromURL 内部流程：
        //   fetch 图片 → 创建 ImageBitmap → 创建 GPUTexture → 上传像素数据
        this.playerTexture = await Texture.createTextureFromURL(device, "src/assets/PNG/playerShip1_blue.png");
        this.ufoRedTexture = await Texture.createTextureFromURL(device, "src/assets/PNG/ufoRed.png");
        this.uvTexture = await Texture.createTextureFromURL(device, "src/assets/uv_test.png");
        this.spriteSheet = await Texture.createTextureFromURL(device,
            "src/assets/Spritesheet/sheet.png");


        this.explosionTexture = await Texture.createTextureFromURL(device, "src/assets/explosion.png");
        this.iceTexture = await Texture.createTextureFromURL(device, "src/assets/ice03.jpg");

        this.backgroundTexture = await Texture.createTextureFromURL(device, "src/assets/Backgrounds/purple.png");

        // 加载精灵表定义：解析 XML 文件，将精灵表中的各个区域映射为 Sprite 对象
        await this.loadSpriteSheet();

        // 加载位图字体：解析 AngelCode BMFont 格式的 XML 元数据 + 纹理图集
        this.spriteFont = await this.loadSnowBSpriteFont(device,
             "src/assets/SpriteFont.xml",
            "src/assets/SpriteFont.png");
    }

    // 加载精灵表（Texture Atlas / Sprite Sheet）
    // 精灵表是一张包含多个子图像的大纹理，通过 XML 描述每个子图像的位置和大小
    // 优点：减少 GPU 纹理切换次数，提高批量绘制效率
    private static async loadSpriteSheet() {
        // 获取精灵表 XML 定义文件（通常由工具如 TexturePacker 生成）
        const sheetXmlReq = await fetch("src/assets/SpriteSheet/sheet.xml");
        const sheetXmlText = await sheetXmlReq.text();

        // 使用浏览器内置的 DOMParser 解析 XML 文本为 DOM 文档
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(sheetXmlText, "text/xml");

        // 遍历所有 SubTexture 元素，每个元素描述精灵表中的一个子精灵
        xmlDoc.querySelectorAll("SubTexture").forEach((subTexture) => {

            // 精灵名称（去掉 .png 后缀作为字典键）
            const name = subTexture.getAttribute("name")!.replace(".png", "");

            // 子精灵在精灵表纹理中的位置和尺寸（像素坐标）
            const x = parseInt(subTexture.getAttribute("x")!);
            const y = parseInt(subTexture.getAttribute("y")!);
            const width = parseInt(subTexture.getAttribute("width")!);
            const height = parseInt(subTexture.getAttribute("height")!);

            // drawRect：绘制矩形，定义精灵在屏幕上的初始位置和大小（通常从 0,0 开始）
            // 后续绘制时会通过变换矩阵调整实际屏幕位置
            const drawRect = new Rect(0, 0, width, height);

            // sourceRect：源矩形，定义精灵在精灵表纹理中的区域（像素坐标）
            // 告诉渲染器从纹理的哪个区域采样
            const sourceRect = new Rect(x, y, width, height);

            // 创建精灵对象并注册到字典中
            this.sprites[name] = new Sprite(this.spriteSheet, drawRect, sourceRect);

        });
    }

    // 加载位图字体（SpriteFont / Bitmap Font）
    // 采用 AngelCode BMFont 格式：
    //   - XML 文件描述每个字符在纹理图集中的位置、大小、偏移等元数据
    //   - PNG 纹理包含所有字符的图像
    // 与矢量字体（TTF）不同，位图字体直接从纹理采样，渲染效率更高
    private static async loadSnowBSpriteFont(
        device: GPUDevice,
        xmlPath: string,       // 字体元数据 XML 文件路径
        texturePath: string,   // 字体纹理图集文件路径
    ): Promise<SpriteFont> {

        // 加载字体纹理图集
        const texture = await Texture.createTextureFromURL(device, texturePath);

        // 获取并解析字体 XML 元数据
        const xmlReq = await fetch(xmlPath);
        const xmlText = await xmlReq.text();

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "text/xml");

        // 获取行高（lineHeight）：字体中两行文字基线之间的标准间距
        const lineHeight = parseInt(xmlDoc.querySelector("common")!.getAttribute("lineHeight")!);

        // 创建 SpriteFont 对象
        const font = new SpriteFont(texture, lineHeight);

        // 遍历所有字符定义
        xmlDoc.querySelectorAll("char").forEach((char) => {

            // 字符的 Unicode 码点，作为字体内部的字符映射键
            const id = parseInt(char.getAttribute("id")!);

            // 字符在纹理图集中的位置和尺寸（像素坐标）
            const x = parseInt(char.getAttribute("x")!);
            const y = parseInt(char.getAttribute("y")!);
            const width = parseInt(char.getAttribute("width")!);
            const height = parseInt(char.getAttribute("height")!);

            // xOffset, yOffset：字符相对于基线/光标位置的偏移量
            // 用于处理字符的垂直对齐（如字母 g 的下伸部分）
            const xOffset = parseInt(char.getAttribute("xoffset")!);
            const yOffset = parseInt(char.getAttribute("yoffset")!);

            // xAdvance：绘制该字符后，光标前进的水平距离
            // 这就是字符的"步进宽度"，决定了下一个字符的起始位置
            const xAdvance = parseInt(char.getAttribute("xadvance")!);

            // 将像素坐标归一化为 UV 纹理坐标（范围 [0, 1]）
            // GPU 纹理采样使用归一化坐标，而不是像素坐标
            // 归一化公式：uv = 像素坐标 / 纹理尺寸
            const x1 = x / texture.width;                  // 左边界
            const y1 = y / texture.height;                 // 上边界
            const x2 = (x + width) / texture.width;        // 右边界
            const y2 = (y + height) / texture.height;      // 下边界

            // 创建四边形（Quad），表示字符在纹理中的 UV 坐标区域
            // 四个顶点按顺序：左上、右上、右下、左下
            const quad = new Quad(
                vec2.fromValues(x1, y1),
                vec2.fromValues(x2, y1),
                vec2.fromValues(x2, y2),
                vec2.fromValues(x1, y2),
            );

            // 将字符信息注册到字体对象中
            font.createChar(id,
                quad,
                vec2.fromValues(width, height),
                xAdvance,
                vec2.fromValues(xOffset, yOffset));
        });

        return font;

    }
}
