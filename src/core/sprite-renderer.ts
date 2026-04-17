/**
 * SpriteRenderer（精灵渲染器）
 *
 * 本模块实现了基于 WebGPU 的 2D 批处理精灵渲染器。
 * 核心思想：将使用同一纹理的多个精灵合并到一次绘制调用（Draw Call）中，
 * 从而大幅减少 GPU 状态切换和绘制调用次数，提升渲染性能。
 *
 * 帧生命周期：
 *   1. framePass()  —— 开始新的一帧，重置批次数据，更新摄像机投影矩阵
 *   2. drawSprite() / drawSpriteSource() / drawString() —— 累积精灵顶点数据到批次
 *   3. frameEnd()   —— 将所有批次提交给 GPU 执行绘制
 *
 * 批处理渲染（Batch Rendering）原理：
 *   - 按纹理 ID 分组：相同纹理的精灵共享同一个渲染管线（Pipeline）和绑定组（BindGroup）
 *   - 每个批次最多容纳 MAX_NUMBER_OF_SPRITES 个精灵
 *   - 每个精灵由 4 个顶点（四边形）和 6 个索引（2 个三角形）组成
 *   - 顶点数据布局：position(2) + uv(2) + color(3) = 7 个 float（28 字节）
 */

import { vec2, type Vec2 } from "wgpu-matrix";
import { BufferUtil } from "../utils/buffer-util";
import { Camera } from "../utils/camera";
import { Color } from "../utils/color";
import { Rect } from "../utils/rect";
import { SpritePipeline } from "./sprite-pipeline";
import { Texture } from "./texture";
import { SpriteFont } from "./sprite-font";

/**
 * 每个批次最多容纳的精灵数量。
 * 当一个批次达到此上限时，会自动创建新的 BatchDrawCall 继续累积。
 */
const MAX_NUMBER_OF_SPRITES = 1000;

/**
 * 每个顶点包含的 float 数量。
 * 顶点布局：x, y（位置）+ u, v（纹理坐标）+ r, g, b（颜色）= 7 个 float
 */
const FLOAT_PER_VERTEX = 7;

/**
 * 每个精灵（四边形）需要的 float 总数。
 * 一个精灵 = 4 个顶点 × 7 个 float/顶点 = 28 个 float
 */
const FLOATS_PER_SPRITE = 4 * FLOAT_PER_VERTEX;

/**
 * 每个精灵需要的索引数量。
 * 一个四边形由 2 个三角形组成，每个三角形 3 个索引，共 6 个索引。
 * 三角形1: 0-1-2，三角形2: 2-3-0
 */
const INIDICES_PER_SPRITE = 6; // 2 triangles per sprite

/**
 * BatchDrawCall（批次绘制调用）
 *
 * 表示一次合并绘制调用，包含：
 *   - pipeline: 该批次使用的渲染管线（与纹理绑定）
 *   - vertexData: CPU 端的顶点数据缓冲区（Float32Array），在 frameEnd() 时上传到 GPU
 *   - instanceCount: 当前批次中已累积的精灵数量
 *
 * 批处理的核心优势：将多个精灵的顶点数据合并到一个大的顶点缓冲区中，
 * 只需一次 drawIndexed() 调用即可绘制所有精灵，避免逐精灵提交绘制命令。
 */
export class BatchDrawCall {
    constructor(public pipeline: SpritePipeline) { }
    public vertexData = new Float32Array(MAX_NUMBER_OF_SPRITES * FLOATS_PER_SPRITE);
    public instanceCount = 0;
}

/**
 * SpriteRenderer（精灵渲染器）
 *
 * 负责管理整个 2D 精灵的批处理渲染流程。主要职责：
 *   1. 管理渲染管线（Pipeline）的缓存 —— 每个纹理对应一个管线实例
 *   2. 按纹理分组收集精灵顶点数据到批次中
 *   3. 顶点缓冲区（Vertex Buffer）的回收复用，避免每帧重新分配 GPU 内存
 *   4. 索引缓冲区（Index Buffer）的预计算和复用
 *   5. 摄像机投影-视图矩阵的更新和上传
 */
export class SpriteRenderer {

    /**
     * 默认白色，当调用方未指定颜色时使用。
     * 白色 (1,1,1) 不会改变纹理的原始颜色。
     */
    private defaultColor = new Color();

    /**
     * 当前正在绘制的纹理。用于检测纹理切换，
     * 以便在纹理变化时进行管线查找和批次管理。
     */
    private currentTexture: Texture | null = null;

    /**
     * 索引缓冲区（GPU 端）。
     * 存储所有精灵共享的索引模式数据，在 setupIndexBuffer() 中一次性预计算。
     * 每个 sprite 对应 6 个索引（2 个三角形），格式为 uint16。
     */
    private indexBuffer!: GPUBuffer;

    /**
     * 投影-视图矩阵的 uniform 缓冲区（GPU 端）。
     * 每帧通过 writeBuffer() 更新，绑定到管线的 bind group 0，
     * 在顶点着色器中用于将世界坐标变换到裁剪空间。
     */
    private projectionViewMatrixBuffer!: GPUBuffer;

    /**
     * 正交摄像机，管理投影矩阵和视图矩阵。
     * 2D 游戏通常使用正交投影（无透视缩放效果）。
     */
    private camera: Camera;

    /**
     * 当前帧的渲染通道编码器。
     * 由外部（通常是游戏主循环）在开始渲染通道时传入，
     * 用于在 frameEnd() 中记录绘制命令。
     */
    private passEncoder!: GPURenderPassEncoder;

    /**
     * 预分配的临时向量，用于旋转计算。
     * v0~v3 分别代表精灵四边形的四个顶点（左上、右上、右下、左下）。
     * 作为成员变量复用，避免每次绘制时频繁创建新对象产生 GC 压力。
     */
    private v0 = vec2.create();
    private v1 = vec2.create();
    private v2 = vec2.create();
    private v3 = vec2.create();

    /**
     * 旋转中心点（临时变量）。
     * 当精灵需要旋转时，先计算旋转中心，再围绕该点旋转四个顶点。
     */
    private rotationOrigin = vec2.create();

    /**
     * Pipelines created for each texture
     * 每个纹理对应的渲染管线缓存。
     * 键为纹理 ID，值为对应的 SpritePipeline 实例。
     * 由于每个管线绑定了特定的纹理和采样器，所以需要按纹理区分。
     * 复用管线避免重复创建，提升性能。
     */
    private pipelinesPerTexture: { [id: string]: SpritePipeline } = {};

    /**
     * The draw calls per texture.
     * 每个纹理对应的批次绘制调用数组。
     * 键为纹理 ID，值为 BatchDrawCall 数组。
     * 当一个批次满了（达到 MAX_NUMBER_OF_SPRITES），会追加新的 BatchDrawCall。
     */
    private batchDrawCallPerTexture: { [id: string]: Array<BatchDrawCall> } = {};

    /**
     * The buffers which are currently allocated and used for vertex data.
     * 已分配的顶点缓冲区对象池（回收站）。
     *
     * 顶点缓冲区回收复用机制：
     *   - frameEnd() 中从池中取出缓冲区，写入数据并使用
     *   - 使用完毕后放回池中，供下一帧复用
     *   - 如果池为空，才创建新的 GPUBuffer
     *   - 这样避免了每帧创建/销毁 GPU 缓冲区带来的性能开销
     */
    private allocatedVertexBuffers: Array<GPUBuffer> = [];

    /**
     * 构造函数。
     * @param device  WebGPU 设备，用于创建 GPU 资源
     * @param width   渲染目标宽度（像素）
     * @param height  渲染目标高度（像素）
     */
    constructor(private device: GPUDevice, private width: number, private height: number) {
        this.camera = new Camera(this.width, this.height);
    }

    /**
     * 设置索引缓冲区。
     *
     * 预计算所有精灵的索引模式。每个精灵（四边形）由 4 个顶点组成，
     * 通过索引缓冲区指定如何将这些顶点组装成 2 个三角形：
     *
     *   三角形 1 (t1): 顶点 0 → 顶点 1 → 顶点 2
     *   三角形 2 (t2): 顶点 2 → 顶点 3 → 顶点 0
     *
     *   v0 --- v1          索引顺序：
     *   |  \   |           t1: [0, 1, 2]
     *   |   \  |           t2: [2, 3, 0]
     *   v3 --- v2
     *
     * 对于第 i 个精灵，其顶点编号为 i*4+0 ~ i*4+3。
     * 所有精灵共享相同的索引模式，只是顶点偏移量不同。
     * 使用 uint16 格式（最大支持 65535 个顶点索引）。
     */
    private setupIndexBuffer() {
        const data = new Uint16Array(MAX_NUMBER_OF_SPRITES * INIDICES_PER_SPRITE);

        for (let i = 0; i < MAX_NUMBER_OF_SPRITES; i++) {
            // t1 （三角形 1：左上 → 右上 → 右下）
            data[i * INIDICES_PER_SPRITE + 0] = i * 4 + 0;
            data[i * INIDICES_PER_SPRITE + 1] = i * 4 + 1;
            data[i * INIDICES_PER_SPRITE + 2] = i * 4 + 2;

            // t2 （三角形 2：右下 → 左下 → 左上）
            data[i * INIDICES_PER_SPRITE + 3] = i * 4 + 2;
            data[i * INIDICES_PER_SPRITE + 4] = i * 4 + 3;
            data[i * INIDICES_PER_SPRITE + 5] = i * 4 + 0;
        }

        this.indexBuffer = BufferUtil.createIndexBuffer(this.device, data);
    }

    /**
     * 初始化渲染器。
     * 创建投影-视图矩阵的 uniform 缓冲区（16 个 float = 4×4 矩阵），
     * 并预计算索引缓冲区。
     */
    public initialize() {

        this.projectionViewMatrixBuffer = BufferUtil.createUniformBuffer(this.device, new Float32Array(16));
        this.setupIndexBuffer();
    }

    /**
     * 开始一帧的渲染通道。
     *
     * 帧生命周期第 1 步。在每次渲染通道开始时调用。
     *
     * @param passEncoder WebGPU 渲染通道编码器，用于后续记录绘制命令
     *
     * 工作流程：
     *   1. 保存渲染通道编码器引用
     *   2. 清空上一帧的批次数据（batchDrawCallPerTexture），准备累积新帧的精灵
     *   3. 重置当前纹理引用
     *   4. 更新摄像机矩阵（处理可能的分辨率变化等）
     *   5. 将最新的投影-视图矩阵上传到 GPU uniform 缓冲区
     */
    public framePass(passEncoder: GPURenderPassEncoder) {
        this.passEncoder = passEncoder;

        this.batchDrawCallPerTexture = {};

        this.currentTexture = null;

        this.camera.update();

        this.device.queue.writeBuffer(
            this.projectionViewMatrixBuffer,
            0,
            this.camera.projectionViewMatrix as Float32Array);
    }


    /**
     * 绘制精灵（使用整个纹理）。
     *
     * @param texture 精灵使用的纹理
     * @param rect    精灵在屏幕上的位置和大小（x, y, width, height）
     *
     * UV 坐标固定为纹理的四角：
     *   左上 (0,0) → 右上 (1,0) → 右下 (1,1) → 左下 (0,1)
     * 颜色固定为白色 (1,1,1)，不改变纹理原始颜色。
     */
    public drawSprite(texture: Texture, rect: Rect) {

        // 纹理切换检测：如果当前纹理与之前不同，需要查找或创建对应的管线和批次
        if (this.currentTexture != texture) {
            this.currentTexture = texture;

            // 查找该纹理是否已有缓存的渲染管线
            let pipeline = this.pipelinesPerTexture[texture.id];
            if (!pipeline) {
                // 首次使用该纹理，创建新的渲染管线
                // 管线包含：着色器模块、顶点布局、混合状态、纹理绑定组等
                pipeline = SpritePipeline.create(this.device, texture, this.projectionViewMatrixBuffer);
                this.pipelinesPerTexture[texture.id] = pipeline;
            }

            // 确保该纹理有对应的批次数组
            let batchDrawCalls = this.batchDrawCallPerTexture[texture.id];
            if (!batchDrawCalls) {
                this.batchDrawCallPerTexture[texture.id] = [];
            }
        }

        // 获取当前纹理的最后一个批次（即正在累积的活跃批次）
        const arrayOfBatchCalls = this.batchDrawCallPerTexture[texture.id];
        let batchDrawCall = arrayOfBatchCalls[arrayOfBatchCalls.length - 1]
        if (!batchDrawCall) {
            // 如果还没有批次，创建一个新的
            batchDrawCall = new BatchDrawCall(this.pipelinesPerTexture[texture.id]);
            this.batchDrawCallPerTexture[texture.id].push(batchDrawCall);
        }

        // 计算当前精灵在顶点数据数组中的起始偏移位置
        let i = batchDrawCall.instanceCount * FLOATS_PER_SPRITE;

        // 左上顶点 (v0)：位置 + UV(0,0) + 颜色(1,1,1)
        batchDrawCall.vertexData[0 + i] = rect.x;
        batchDrawCall.vertexData[1 + i] = rect.y;
        batchDrawCall.vertexData[2 + i] = 0.0;
        batchDrawCall.vertexData[3 + i] = 0.0;
        batchDrawCall.vertexData[4 + i] = 1.0;
        batchDrawCall.vertexData[5 + i] = 1.0;
        batchDrawCall.vertexData[6 + i] = 1.0;

        // 右上顶点 (v1)：位置 + UV(1,0) + 颜色(1,1,1)
        batchDrawCall.vertexData[7 + i] = rect.x + rect.width;
        batchDrawCall.vertexData[8 + i] = rect.y;
        batchDrawCall.vertexData[9 + i] = 1.0;
        batchDrawCall.vertexData[10 + i] = 0.0;
        batchDrawCall.vertexData[11 + i] = 1.0;
        batchDrawCall.vertexData[12 + i] = 1.0;
        batchDrawCall.vertexData[13 + i] = 1.0;

        // 右下顶点 (v2)：位置 + UV(1,1) + 颜色(1,1,1)
        batchDrawCall.vertexData[14 + i] = rect.x + rect.width;
        batchDrawCall.vertexData[15 + i] = rect.y + rect.height;
        batchDrawCall.vertexData[16 + i] = 1.0;
        batchDrawCall.vertexData[17 + i] = 1.0;
        batchDrawCall.vertexData[18 + i] = 1.0;
        batchDrawCall.vertexData[19 + i] = 1.0;
        batchDrawCall.vertexData[20 + i] = 1.0;

        // 左下顶点 (v3)：位置 + UV(0,1) + 颜色(1,1,1)
        batchDrawCall.vertexData[21 + i] = rect.x;
        batchDrawCall.vertexData[22 + i] = rect.y + rect.height;
        batchDrawCall.vertexData[23 + i] = 0.0;
        batchDrawCall.vertexData[24 + i] = 1.0;
        batchDrawCall.vertexData[25 + i] = 1.0;
        batchDrawCall.vertexData[26 + i] = 1.0;
        batchDrawCall.vertexData[27 + i] = 1.0;


        batchDrawCall.instanceCount++;

        // 批次满时自动创建新批次，确保后续精灵能继续累积
        if (batchDrawCall.instanceCount >= MAX_NUMBER_OF_SPRITES) {
            const newBatchDrawCall = new BatchDrawCall(this.pipelinesPerTexture[texture.id]);
            this.batchDrawCallPerTexture[texture.id].push(newBatchDrawCall);
        }

    }

    /**
     * 绘制精灵（支持纹理区域裁剪、颜色着色和旋转）。
     *
     * @param texture       精灵使用的纹理
     * @param rect          精灵在屏幕上的位置和大小
     * @param sourceRect    纹理上的裁剪区域（纹理图集 / Texture Atlas 的子区域）
     * @param color         颜色调制（与纹理颜色相乘），默认白色不改变纹理
     * @param rotation      旋转角度（弧度），0 表示不旋转
     * @param rotationAnchor 旋转锚点（相对于精灵左上角的归一化坐标 0~1），
     *                       null 表示以左上角为旋转中心
     *
     * 纹理图集（Texture Atlas）UV 坐标计算：
     *   sourceRect 的像素坐标除以纹理的宽高，得到归一化的 UV 坐标 (0~1)。
     *   这样片段着色器可以通过插值 UV 坐标采样纹理的正确区域。
     *
     * 旋转实现：
     *   1. 先计算四个顶点的初始位置（未旋转）
     *   2. 确定旋转中心（rotationOrigin）
     *   3. 使用 vec2.rotate() 将四个顶点围绕旋转中心旋转指定角度
     */
    public drawSpriteSource(texture: Texture, rect: Rect, sourceRect: Rect,
        color: Color = this.defaultColor, rotation = 0, rotationAnchor: Vec2 | null = null) {

        // 纹理切换检测，与 drawSprite() 相同的逻辑
        if (this.currentTexture != texture) {
            this.currentTexture = texture;

            let pipeline = this.pipelinesPerTexture[texture.id];
            if (!pipeline) {
                pipeline = SpritePipeline.create(this.device, texture, this.projectionViewMatrixBuffer);
                this.pipelinesPerTexture[texture.id] = pipeline;
            }

            let batchDrawCalls = this.batchDrawCallPerTexture[texture.id];
            if (!batchDrawCalls) {
                this.batchDrawCallPerTexture[texture.id] = [];
            }
        }

        // 获取或创建当前批次
        const arrayOfBatchCalls = this.batchDrawCallPerTexture[texture.id];
        let batchDrawCall = arrayOfBatchCalls[arrayOfBatchCalls.length - 1]
        if (!batchDrawCall) {
            batchDrawCall = new BatchDrawCall(this.pipelinesPerTexture[texture.id]);
            this.batchDrawCallPerTexture[texture.id].push(batchDrawCall);
        }

        // 计算当前精灵在顶点数据数组中的起始偏移位置
        let i = batchDrawCall.instanceCount * FLOATS_PER_SPRITE;

        // ===== 纹理图集 UV 坐标计算 =====
        // 将 sourceRect 的像素坐标转换为归一化纹理坐标 (0.0 ~ 1.0)
        // u0,v0 = 裁剪区域左上角的 UV 坐标
        // u1,v1 = 裁剪区域右下角的 UV 坐标
        let u0 = sourceRect.x / texture.width;
        let v0 = sourceRect.y / texture.height;
        let u1 = (sourceRect.x + sourceRect.width) / texture.width;
        let v1 = (sourceRect.y + sourceRect.height) / texture.height;

        // ===== 计算四个顶点的屏幕坐标 =====
        // v0=左上, v1=右上, v2=右下, v3=左下
        this.v0[0] = rect.x;
        this.v0[1] = rect.y;
        this.v1[0] = rect.x + rect.width;
        this.v1[1] = rect.y;
        this.v2[0] = rect.x + rect.width;
        this.v2[1] = rect.y + rect.height;
        this.v3[0] = rect.x;
        this.v3[1] = rect.y + rect.height;

        // ===== 旋转处理 =====
        // 如果指定了旋转角度，围绕旋转锚点旋转所有四个顶点
        if (rotation != 0) {
            // 确定旋转中心点
            if (rotationAnchor == null) {
                // 未指定锚点时，以左上角 (v0) 为旋转中心
                vec2.copy(this.v0, this.rotationOrigin);
            }
            else {
                // 根据 rotationAnchor（归一化坐标 0~1）计算实际的旋转中心
                // rotationAnchor = (0.5, 0.5) 表示精灵中心
                this.rotationOrigin[0] = this.v0[0] + rotationAnchor[0] * rect.width;
                this.rotationOrigin[1] = this.v0[1] + rotationAnchor[1] * rect.height;
            }

            // 围绕旋转中心旋转四个顶点
            // vec2.rotate(point, origin, angle, result) —— 将 point 绕 origin 旋转 angle 弧度
            vec2.rotate(this.v0, this.rotationOrigin, rotation, this.v0);
            vec2.rotate(this.v1, this.rotationOrigin, rotation, this.v1);
            vec2.rotate(this.v2, this.rotationOrigin, rotation, this.v2);
            vec2.rotate(this.v3, this.rotationOrigin, rotation, this.v3);
        }

        // 左上顶点 (v0)：位置 + UV(u0,v0) + 颜色
        batchDrawCall.vertexData[0 + i] = this.v0[0];
        batchDrawCall.vertexData[1 + i] = this.v0[1];
        batchDrawCall.vertexData[2 + i] = u0;
        batchDrawCall.vertexData[3 + i] = v0;
        batchDrawCall.vertexData[4 + i] = color.r;
        batchDrawCall.vertexData[5 + i] = color.g;
        batchDrawCall.vertexData[6 + i] = color.b;

        // 右上顶点 (v1)：位置 + UV(u1,v0) + 颜色
        batchDrawCall.vertexData[7 + i] = this.v1[0];
        batchDrawCall.vertexData[8 + i] = this.v1[1];
        batchDrawCall.vertexData[9 + i] = u1;
        batchDrawCall.vertexData[10 + i] = v0;
        batchDrawCall.vertexData[11 + i] = color.r;
        batchDrawCall.vertexData[12 + i] = color.g;
        batchDrawCall.vertexData[13 + i] = color.b;

        // 右下顶点 (v2)：位置 + UV(u1,v1) + 颜色
        batchDrawCall.vertexData[14 + i] = this.v2[0];
        batchDrawCall.vertexData[15 + i] = this.v2[1];
        batchDrawCall.vertexData[16 + i] = u1;
        batchDrawCall.vertexData[17 + i] = v1;
        batchDrawCall.vertexData[18 + i] = color.r;
        batchDrawCall.vertexData[19 + i] = color.g;
        batchDrawCall.vertexData[20 + i] = color.b;

        // 左下顶点 (v3)：位置 + UV(u0,v1) + 颜色
        batchDrawCall.vertexData[21 + i] = this.v3[0];
        batchDrawCall.vertexData[22 + i] = this.v3[1];
        batchDrawCall.vertexData[23 + i] = u0;
        batchDrawCall.vertexData[24 + i] = v1;
        batchDrawCall.vertexData[25 + i] = color.r;
        batchDrawCall.vertexData[26 + i] = color.g;
        batchDrawCall.vertexData[27 + i] = color.b;


        batchDrawCall.instanceCount++;

        // 批次满时自动创建新批次
        if (batchDrawCall.instanceCount >= MAX_NUMBER_OF_SPRITES) {
            const newBatchDrawCall = new BatchDrawCall(this.pipelinesPerTexture[texture.id]);
            this.batchDrawCallPerTexture[texture.id].push(newBatchDrawCall);
        }

    }

    /**
     * 使用位图字体（SpriteFont）绘制文本字符串。
     *
     * @param font      位图字体，包含纹理图集和字符元数据
     * @param text      要绘制的文本内容
     * @param position  文本起始位置（左上角）
     * @param color     文本颜色
     * @param scale     缩放因子（默认 1.0）
     *
     * 实现原理：
     *   位图字体将每个字符预渲染到纹理图集上的一个子区域中。
     *   每个字符是一个精灵（四边形），从纹理图集中采样对应区域。
     *   通过字符编码查找对应的纹理坐标和偏移信息，逐字符绘制。
     */
    public drawString(font: SpriteFont, text: string,
        position: Vec2, color: Color = this.defaultColor, scale = 1) {

        const texture = font.texture;
        // 纹理切换检测，与 drawSprite() 相同的逻辑
        if (this.currentTexture != texture) {
            this.currentTexture = texture;

            let pipeline = this.pipelinesPerTexture[texture.id];
            if (!pipeline) {
                pipeline = SpritePipeline.create(this.device, texture, this.projectionViewMatrixBuffer);
                this.pipelinesPerTexture[texture.id] = pipeline;
            }

            let batchDrawCalls = this.batchDrawCallPerTexture[texture.id];
            if (!batchDrawCalls) {
                this.batchDrawCallPerTexture[texture.id] = [];
            }
        }

        // 获取或创建当前批次
        const arrayOfBatchCalls = this.batchDrawCallPerTexture[texture.id];
        let batchDrawCall = arrayOfBatchCalls[arrayOfBatchCalls.length - 1]
        if (!batchDrawCall) {
            batchDrawCall = new BatchDrawCall(this.pipelinesPerTexture[texture.id]);
            this.batchDrawCallPerTexture[texture.id].push(batchDrawCall);
        }

        /**
         * 逐字符绘制文本。
         * nextCharX 追踪当前字符的水平偏移（基于字体的 advance 宽度）。
         */
        let nextCharX = 0;
        for (let j = 0; j < text.length; j++) {

            // 获取字符编码，从字体中查找对应的字符元数据
            const charCode = text[j].charCodeAt(0);
            const char = font.getChar(charCode);

            // 计算当前字符精灵的屏幕坐标
            // char.offset 是字符相对于基线的偏移量
            // nextCharX 是前一个字符的 advance 累计值
            let i = batchDrawCall.instanceCount * FLOATS_PER_SPRITE;

            const x = position[0] + (nextCharX + char.offset[0]) * scale;
            const y = position[1] + char.offset[1] * scale;
            const width = char.size[0] * scale;
            const height = char.size[1] * scale;

            // 计算四个顶点的屏幕坐标
            this.v0[0] = x;
            this.v0[1] = y;
            this.v1[0] = x + width;
            this.v1[1] = y;
            this.v2[0] = x + width;
            this.v2[1] = y + height;
            this.v3[0] = x;
            this.v3[1] = y + height;

            // 获取字符在纹理图集中的四个角的 UV 坐标
            const a = char.textureCoords.topLeft;
            const b = char.textureCoords.topRight;
            const c = char.textureCoords.bottomRight;
            const d = char.textureCoords.bottomLeft;

            // 左上顶点 (v0)：位置 + 字符UV(a) + 颜色
            batchDrawCall.vertexData[0 + i] = this.v0[0];
            batchDrawCall.vertexData[1 + i] = this.v0[1];
            batchDrawCall.vertexData[2 + i] = a[0];
            batchDrawCall.vertexData[3 + i] = a[1];
            batchDrawCall.vertexData[4 + i] = color.r;
            batchDrawCall.vertexData[5 + i] = color.g;
            batchDrawCall.vertexData[6 + i] = color.b;

            // 右上顶点 (v1)：位置 + 字符UV(b) + 颜色
            batchDrawCall.vertexData[7 + i] = this.v1[0];
            batchDrawCall.vertexData[8 + i] = this.v1[1];
            batchDrawCall.vertexData[9 + i] = b[0];
            batchDrawCall.vertexData[10 + i] = b[1];
            batchDrawCall.vertexData[11 + i] = color.r;
            batchDrawCall.vertexData[12 + i] = color.g;
            batchDrawCall.vertexData[13 + i] = color.b;

            // 右下顶点 (v2)：位置 + 字符UV(c) + 颜色
            batchDrawCall.vertexData[14 + i] = this.v2[0];
            batchDrawCall.vertexData[15 + i] = this.v2[1];
            batchDrawCall.vertexData[16 + i] = c[0];
            batchDrawCall.vertexData[17 + i] = c[1];
            batchDrawCall.vertexData[18 + i] = color.r;
            batchDrawCall.vertexData[19 + i] = color.g;
            batchDrawCall.vertexData[20 + i] = color.b;

            // 左下顶点 (v3)：位置 + 字符UV(d) + 颜色
            batchDrawCall.vertexData[21 + i] = this.v3[0];
            batchDrawCall.vertexData[22 + i] = this.v3[1];
            batchDrawCall.vertexData[23 + i] = d[0];
            batchDrawCall.vertexData[24 + i] = d[1];
            batchDrawCall.vertexData[25 + i] = color.r;
            batchDrawCall.vertexData[26 + i] = color.g;
            batchDrawCall.vertexData[27 + i] = color.b;


            batchDrawCall.instanceCount++;

            // 累加字符的 advance 宽度，定位下一个字符
            nextCharX += char.advance;

            // 批次满时自动创建新批次
            if (batchDrawCall.instanceCount >= MAX_NUMBER_OF_SPRITES) {
                batchDrawCall = new BatchDrawCall(this.pipelinesPerTexture[texture.id]);
                this.batchDrawCallPerTexture[texture.id].push(batchDrawCall);
            }
        }
    }


    /**
     * 结束当前帧的渲染，提交所有批次到 GPU。
     *
     * 帧生命周期第 3 步。在所有 drawSprite/drawSpriteSource/drawString 调用之后调用。
     *
     * 工作流程：
     *   1. 遍历所有纹理的批次数据
     *   2. 对每个批次：
     *      a. 从顶点缓冲区池中取出或新建一个 GPUBuffer
     *      b. 将 CPU 端的顶点数据上传到 GPU 缓冲区
     *      c. 设置渲染管线、索引缓冲区、顶点缓冲区、绑定组
     *      d. 调用 drawIndexed() 执行绘制
     *   3. 将使用过的顶点缓冲区回收至对象池，供下一帧复用
     *
     * 顶点缓冲区回收机制：
     *   - allocatedVertexBuffers 是一个栈结构的对象池
     *   - 本帧使用的缓冲区在 usedVertexBuffers 中临时保存
     *   - 帧结束后将它们 push 回 allocatedVertexBuffers
     *   - 下一帧可以直接 pop 复用，无需重新分配 GPU 内存
     */
    public frameEnd() {

        let usedVertexBuffers = [];

        // 遍历每个纹理的批次数据，按纹理分组提交绘制
        for (const key in this.batchDrawCallPerTexture) {

            const arrayOfBatchDrawCalls = this.batchDrawCallPerTexture[key];

            for (const batchDrawCall of arrayOfBatchDrawCalls) {

                // 跳过空批次
                if (batchDrawCall.instanceCount == 0) continue;

                // ===== 顶点缓冲区复用 =====
                // 从对象池中取出一个已分配的缓冲区，如果池为空则创建新的
                let vertexBuffer = this.allocatedVertexBuffers.pop();
                if (!vertexBuffer) {
                    vertexBuffer = BufferUtil.createVertexBuffer(this.device, batchDrawCall.vertexData);
                }
                else {
                    // 复用已有缓冲区，通过 writeBuffer() 更新数据
                    // 这比每帧创建/销毁缓冲区高效得多
                    this.device.queue.writeBuffer(vertexBuffer, 0, batchDrawCall.vertexData);
                }


                usedVertexBuffers.push(vertexBuffer);
                const spritePipeline = batchDrawCall.pipeline;

                // ===== 提交绘制命令到渲染通道 =====
                // 设置渲染管线（包含着色器、混合状态、管线布局等）
                this.passEncoder.setPipeline(spritePipeline.pipeline);
                // 设置索引缓冲区（所有批次共享同一个索引缓冲区）
                this.passEncoder.setIndexBuffer(this.indexBuffer, "uint16");
                // 设置顶点缓冲区（绑定到 slot 0，对应着色器中 @location(0) 的顶点缓冲区）
                this.passEncoder.setVertexBuffer(0, vertexBuffer);
                // 绑定 group(0)：投影-视图矩阵 uniform 缓冲区
                this.passEncoder.setBindGroup(0, spritePipeline.projectionViewBindGroup);
                // 绑定 group(1)：纹理 + 采样器
                this.passEncoder.setBindGroup(1, spritePipeline.textureBindGroup);
                // 执行索引绘制：6 个索引 × 精灵数量 = 总索引数
                this.passEncoder.drawIndexed(6 * batchDrawCall.instanceCount); // draw 3 vertices
            }

        }

        // 将本帧使用过的顶点缓冲区回收至对象池
        for (let vertexBuffer of usedVertexBuffers) {
            this.allocatedVertexBuffers.push(vertexBuffer);
        }
    }
}
