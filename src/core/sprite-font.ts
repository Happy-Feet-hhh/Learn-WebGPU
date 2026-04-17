/**
 * 位图字体模块 (Sprite Font / Bitmap Font Module)
 *
 * 本文件实现了基于纹理图集的位图字体系统（Bitmap Font）。位图字体是一种将字符预渲染到
 * 纹理图集上，然后在运行时通过纹理采样来绘制文字的技术。与矢量字体（如 FreeType）不同，
 * 位图字体在特定尺寸下具有最佳的渲染质量和性能，因为字符的像素数据已经预先计算好。
 *
 * 位图字体的工作流程：
 * 1. 准备阶段：将所有需要的字符渲染到一张纹理图集上（通常使用工具如 BMFont、Hiero 等）
 * 2. 加载阶段：解析字体描述文件，提取每个字符在纹理图集中的位置和度量信息
 * 3. 渲染阶段：根据文本内容，查找每个字符的纹理坐标，构建对应的四边形进行绘制
 *
 * 与 WebGPU 纹理系统的关系：
 * - 字符图像存储在 GPUTexture 中，通过 GPUSampler 进行采样
 * - 每个字符对应纹理图集中的一个子区域（由 Quad 定义的 UV 坐标）
 * - 文字渲染本质上是一系列精灵（Sprite）的批量绘制
 */

import { type Vec2 } from "wgpu-matrix";
import { Quad } from "../utils/quad";
import { Texture } from "./texture";

/**
 * SpriteFontChar 类 - 表示位图字体中的单个字符的度量信息
 *
 * 在排版和渲染文字时，每个字符需要以下关键信息：
 * - 在纹理图集中的位置（用于采样字符图像）
 * - 字符的视觉尺寸（用于确定四边形大小）
 * - 水平步进值（用于确定下一个字符的起始位置）
 * - 渲染偏移（用于微调字符的垂直和水平位置）
 *
 * 这些度量值通常来源于字体度量文件（如 BMFont 的 .fnt 或 AngelCode 格式）。
 */
export class SpriteFontChar {

    /**
     * 构造函数 - 创建字符度量信息
     *
     * @param textureCoords - 纹理坐标（Quad 类型），定义该字符在纹理图集中的位置。
     *                        Quad 通常包含四个顶点的 UV 坐标，形成一个矩形区域。
     *                        在片段着色器中，这些坐标用于从纹理的正确区域采样出字符的像素数据。
     *                        UV 坐标的范围通常为 [0.0, 1.0]，归一化到纹理的完整尺寸。
     * @param size          - 字符的视觉尺寸（Vec2 类型），以像素为单位。
     *                        size[0]：字符的宽度，决定了渲染四边形的水平大小
     *                        size[1]：字符的高度，决定了渲染四边形的垂直大小
     *                        注意：这个尺寸是字符的有效边界框大小，不一定等于步进值（advance）。
     * @param advance       - 水平步进值（Advance Width），以像素为单位。
     *                        从当前字符的原点到下一个字符原点的水平距离。
     *                        通常大于字符宽度，因为它包含了字符右侧的空白间距。
     *                        在排版计算中，每个字符的水平位置 = 前一个字符位置 + 前一个字符的 advance。
     * @param offset        - 渲染偏移（Vec2 类型），以像素为单位。
     *                        offset[0]：水平偏移，字符图像相对于字符原点的水平位移。
     *                        offset[1]：垂直偏移，字符图像相对于基线（Baseline）的垂直位移。
     *                        偏移用于处理字符的精确定位，例如下伸字符（如 g, p, y）需要向下偏移，
     *                        而上伸字符（如 b, d, h）可能不需要偏移。
     */
    constructor(public textureCoords: Quad,
        public size: Vec2,
        public advance: number,
        public offset: Vec2) {

    }
}


/**
 * SpriteFont 类 - 位图字体，管理字符纹理图集和字符度量数据
 *
 * SpriteFont 将一张包含所有字符图像的纹理图集与字符度量数据结合在一起，
 * 提供文字排版和渲染所需的所有信息。一个 SpriteFont 实例通常对应一种字体
 * 在特定尺寸和样式（如粗体、斜体）下的渲染数据。
 *
 * 使用流程：
 * 1. 加载字体纹理图集（Texture）
 * 2. 解析字体描述文件，调用 createChar() 注册每个字符的度量信息
 * 3. 渲染文字时，调用 getChar() 获取字符信息，计算四边形位置，进行批量绘制
 */
export class SpriteFont {

    /**
     * 字符映射表，以 Unicode 码位为键，SpriteFontChar 为值。
     * 支持快速 O(1) 查找任意字符的度量信息。
     * 例如：chars[65] 对应大写字母 'A' 的 SpriteFontChar（Unicode 码位 65）
     */
    private chars: { [id: number]: SpriteFontChar } = {};

    /**
     * 构造函数 - 创建位图字体实例
     *
     * @param texture    - 字体纹理图集（Texture 对象），包含所有字符的预渲染图像。
     *                     纹理图集通常是一张较大的纹理（如 256x256 或 512x512），
     *                     上面按网格或自定义布局排列了所有字符的图像。
     * @param lineHeight - 行高（Line Height），以像素为单位。
     *                     指定一行文字的基线到下一行基线的垂直距离。
     *                     通常大于最大字符高度，以提供行间距。
     *                     在多行文字排版中，每行的 Y 坐标 = 上一行 Y 坐标 + lineHeight。
     */
    constructor(public readonly texture: Texture,
        public readonly lineHeight: number
    ) {

    }

    /**
     * 获取指定字符的度量信息
     *
     * 通过 Unicode 码位查找字符在纹理图集中的位置和排版参数。
     * 如果字符未注册（不在字体中），返回 undefined，调用方应提供回退处理
     * （如显示默认字符 '□' 或跳过）。
     *
     * @param unicode - 字符的 Unicode 码位（例如 'A' 的码位为 65，可通过 'A'.charCodeAt(0) 获取）
     * @returns SpriteFontChar | undefined - 字符的度量信息，包含纹理坐标、尺寸、步进值和偏移
     */
    public getChar(unicode: number): SpriteFontChar {
        return this.chars[unicode];
    }

    /**
     * 注册一个字符的度量信息
     *
     * 在加载字体描述文件时调用此方法，将每个字符的排版数据注册到映射表中。
     * 如果同一 Unicode 码位被多次注册，后注册的数据会覆盖先前的数据。
     *
     * @param unicode        - 字符的 Unicode 码位
     * @param textureCoords  - 字符在纹理图集中的纹理坐标（归一化 UV 坐标）
     * @param size           - 字符的视觉尺寸 [宽度, 高度]（像素）
     * @param advance        - 水平步进值（像素），用于计算下一个字符的位置
     * @param offset         - 渲染偏移 [水平偏移, 垂直偏移]（像素），用于精确定位字符
     */
    public createChar(unicode: number,
        textureCoords: Quad,
        size: Vec2,
        advance: number,
        offset: Vec2) {
        this.chars[unicode] = new SpriteFontChar(textureCoords, size, advance, offset);
    }
}
