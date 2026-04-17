/**
 * BlurEffect - 高斯模糊效果类（双通道分离式模糊）
 *
 * 【高斯模糊原理】
 * 高斯模糊是一种图像平滑滤波器，它使用高斯函数作为权重对周围像素进行加权平均。
 * 二维高斯核是可分离的（separable），这意味着一个 2D 卷积可以分解为两个 1D 卷积：
 *   - 水平通道（Horizontal Pass）：在水平方向上进行 1D 高斯卷积
 *   - 垂直通道（Vertical Pass）：在垂直方向上进行 1D 高斯卷积
 *
 * 【性能优势】
 * 直接使用 N×N 的 2D 高斯核需要进行 N² 次纹理采样。
 * 而分离为两个 1D 通道后，只需要 2N 次采样，大大提高了性能。
 * 例如，9×9 的核从 81 次采样降低到 18 次采样。
 *
 * 【本类实现的双通道模糊流程】
 *   输入纹理 → [水平模糊通道] → horizontalPassRenderTexture
 *   horizontalPassRenderTexture → [垂直模糊通道] → 输出目标
 *
 * 注意：本类与 BloomBlurEffect 的区别在于：
 *   - BlurEffect: 自身拥有两个渲染纹理，分别用于两个通道
 *   - BloomBlurEffect: 使用乒乓（ping-pong）渲染技术，复用外部纹理
 *
 * 【两个渲染纹理的作用】
 *   horizontalPassRenderTexture: 同时作为水平通道的输入（绑定组采样源）和垂直通道的临时中转
 *   verticalPassRenderTexture:   存储垂直通道的采样源，以及最终可选的输出
 */

import { BufferUtil } from "../utils/buffer-util";
import { Texture } from "../core/texture";
import shaderSource from "../shaders/blur-effect.wgsl?raw"

export class BlurEffect {

    // =====================================================================
    // 水平模糊通道资源
    // pipeline: 水平方向的模糊渲染管线（片段着色器入口为 fragmentMainHorizontal）
    // renderTexture: 水平通道的输入纹理（绑定到采样器组），外部场景渲染到该纹理上
    // bindGroup: 将 renderTexture 绑定到着色器
    // =====================================================================
    private horizontalPassPipeline!: GPURenderPipeline;
    private horizontalPassRenderTexture!: Texture;
    private horizontalPassBindGroup!: GPUBindGroup;

    // =====================================================================
    // 垂直模糊通道资源
    // pipeline: 垂直方向的模糊渲染管线（片段着色器入口为 fragmentMainVertical）
    // renderTexture: 垂直通道的输入纹理（存储水平模糊的结果）
    // bindGroup: 将 renderTexture 绑定到着色器
    // =====================================================================
    private verticalPassPipeline!: GPURenderPipeline;
    private verticalPassRenderTexture!: Texture;
    private verticalPassBindGroup!: GPUBindGroup;

    /**
     * 控制是否执行水平模糊通道。设为 false 可跳过水平通道。
     */
    public doHorizontalPass = true;

    /**
     * 控制是否执行垂直模糊通道。设为 false 可跳过垂直通道。
     */
    public doVerticalPass = true;

    /**
     * 创建模糊渲染管线。
     * 根据参数创建水平或垂直方向的模糊管线。
     * 两种管线共享相同的顶点着色器和绑定组布局，
     * 但使用不同的片段着色器入口函数：
     *   - horizontal=true  → "fragmentMainHorizontal" (水平方向采样)
     *   - horizontal=false → "fragmentMainVertical"   (垂直方向采样)
     *
     * @param shaderSource          - WGSL 着色器源代码
     * @param textureBindGroupLayout - 纹理绑定组布局
     * @param horizontal            - true 创建水平管线，false 创建垂直管线
     * @returns 创建好的渲染管线
     */
    private createPipeline(shaderSource: string,
        textureBindGroupLayout: GPUBindGroupLayout,
        horizontal: boolean
    ): GPURenderPipeline {
        const shaderModule = this.device.createShaderModule({
            code: shaderSource
        });


        const desc: GPURenderPipelineDescriptor = {
            layout: this.device.createPipelineLayout({
                bindGroupLayouts: [textureBindGroupLayout]
            }),
            vertex: {
                module: shaderModule,
                entryPoint: "vertexMain",
                buffers: [
                    {
                        // 顶点步长：4个float × 4字节 = 16字节
                        arrayStride: 4 * Float32Array.BYTES_PER_ELEMENT,
                        attributes: [
                            {
                                // 位置属性 (x, y)
                                shaderLocation: 0,
                                offset: 0,
                                format: "float32x2"
                            },
                            {
                                // 纹理坐标属性 (u, v)
                                shaderLocation: 1,
                                offset: 2 * Float32Array.BYTES_PER_ELEMENT,
                                format: "float32x2"
                            }
                        ]
                    }
                ]
            },
            fragment: {
                module: shaderModule,
                // 根据方向选择不同的片段着色器入口
                // 水平入口沿 x 轴采样相邻像素，垂直入口沿 y 轴采样相邻像素
                entryPoint: horizontal ? "fragmentMainHorizontal" : "fragmentMainVertical",
                targets: [
                    {
                        format: "bgra8unorm"
                    }
                ]
            },
            primitive: {
                topology: "triangle-list"
            }
        };

        return this.device.createRenderPipeline(desc);
    }

    /**
     * 全屏四边形顶点缓冲区（与所有后处理效果共享相同的顶点数据）
     */
    private gpuBuffer!: GPUBuffer;



    /**
     * 获取最终的渲染纹理。
     * 返回最后一个执行通道对应的渲染纹理，供后续效果使用。
     *
     * 【优先级逻辑】
     * 如果只启用水平通道 → 返回 horizontalPassRenderTexture
     * 如果只启用垂直通道 → 返回 verticalPassRenderTexture
     * 如果两个都启用    → 返回 verticalPassRenderTexture（垂直通道是最后执行的）
     *
     * @returns 最终输出的渲染纹理，如果没有启用任何通道则返回 null
     */
    public getRenderTexture(): Texture | null {
        if (this.doHorizontalPass) {
            return this.horizontalPassRenderTexture;
        }
        if (this.doVerticalPass) {
            return this.verticalPassRenderTexture;
        }

        return null;
    }

    /**
     * 构造函数
     * @param device - GPU 设备
     * @param width  - 渲染纹理宽度
     * @param height - 渲染纹理高度
     */
    constructor(private device: GPUDevice,
        public width: number,
        public height: number) {

    }

    /**
     * 初始化模糊效果的所有 GPU 资源。
     * 创建两个渲染纹理、绑定组和两条渲染管线。
     */
    public async initialize() {
        // =====================================================================
        // 创建两个渲染纹理：
        //   horizontalPassRenderTexture: 水平通道的输入纹理（场景直接渲染到此）
        //   verticalPassRenderTexture:   垂直通道的输入纹理（存储水平模糊的中间结果）
        //
        // 【数据流向】
        // 场景 → horizontalPassRenderTexture → [水平模糊] → verticalPassRenderTexture → [垂直模糊] → 输出
        //
        // 注意：horizontalPassRenderTexture 同时充当两个角色：
        //   1. 它是场景渲染的目标（外部使用）
        //   2. 它是水平模糊通道的采样源（绑定到 horizontalPassBindGroup）
        // =====================================================================
        this.horizontalPassRenderTexture = await Texture.createEmptyTexture(this.device, this.width, this.height, "bgra8unorm");
        this.verticalPassRenderTexture = await Texture.createEmptyTexture(this.device, this.width, this.height, "bgra8unorm");

        // 全屏四边形顶点数据
        this.gpuBuffer = BufferUtil.createVertexBuffer(this.device, new Float32Array([
            // pos(x,y) tex(u,v)

            // first triangle
            // top left 
            -1.0, 1.0, 0.0, 0.0,
            // top right
            1.0, 1.0, 1.0, 0.0,
            // bottom left 
            -1.0, -1.0, 0.0, 1.0,

            // second triangle
            // bottom left
            -1.0, -1.0, 0.0, 1.0,
            // top right
            1.0, 1.0, 1.0, 0.0,
            // bottom right
            1.0, -1.0, 1.0, 1.0
        ]));

        // =====================================================================
        // 绑定组布局：采样器 + 纹理（两个通道共用相同的布局结构）
        // =====================================================================
        const textureBindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: {}
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {}
                }
            ]
        });

        // =====================================================================
        // 水平通道绑定组：绑定 horizontalPassRenderTexture
        // 水平模糊着色器从此纹理采样，在 x 方向进行高斯加权平均
        // =====================================================================
        this.horizontalPassBindGroup = this.device.createBindGroup({
            layout: textureBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: this.horizontalPassRenderTexture.sampler
                },
                {
                    binding: 1,
                    resource: this.horizontalPassRenderTexture.texture.createView()
                }
            ]
        });

        // =====================================================================
        // 垂直通道绑定组：绑定 verticalPassRenderTexture
        // 垂直模糊着色器从此纹理采样，在 y 方向进行高斯加权平均
        // =====================================================================
        this.verticalPassBindGroup = this.device.createBindGroup({
            layout: textureBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: this.verticalPassRenderTexture.sampler
                },
                {
                    binding: 1,
                    resource: this.verticalPassRenderTexture.texture.createView()
                }
            ]
        });


        // 创建水平和垂直两条渲染管线
        this.horizontalPassPipeline = this.createPipeline(shaderSource, textureBindGroupLayout, true);
        this.verticalPassPipeline = this.createPipeline(shaderSource, textureBindGroupLayout, false);
    }

    /**
     * 执行双通道高斯模糊。
     *
     * 【完整的模糊流程】
     *
     * 第一步：水平模糊通道
     *   输入：horizontalPassRenderTexture（场景渲染的原始结果）
     *   处理：片段着色器沿水平方向采样相邻像素，按高斯权重加权平均
     *   输出：verticalPassRenderTexture（如果还要做垂直通道）
     *         或 destinationTextureView（如果只做水平通道）
     *
     *   数据流：horizontalPassRenderTexture → [水平模糊] → verticalPassRenderTexture
     *
     * 第二步：垂直模糊通道
     *   输入：verticalPassRenderTexture（水平模糊的输出）
     *   处理：片段着色器沿垂直方向采样相邻像素，按高斯权重加权平均
     *   输出：destinationTextureView
     *
     *   数据流：verticalPassRenderTexture → [垂直模糊] → destinationTextureView
     *
     * 【关于纹理复用】
     * 注意水平通道的输出目标是 verticalPassRenderTexture（而非单独的中间纹理）。
     * 这是一种巧妙的资源复用：verticalPassRenderTexture 既是垂直通道的输入源，
     * 也作为水平通道的输出目标。这不会产生冲突，因为：
     *   1. 水平通道写入 verticalPassRenderTexture 时，采样的是 horizontalPassRenderTexture
     *   2. 垂直通道采样 verticalPassRenderTexture 时，是在水平通道完成后才执行的
     *
     * @param destinationTextureView - 最终输出目标纹理视图
     */
    public draw(destinationTextureView: GPUTextureView) {

        // =================================================================
        // 水平模糊通道（HORIZONTAL PASS）
        // 从 horizontalPassRenderTexture 采样，水平方向模糊，
        // 结果写入 verticalPassRenderTexture（如果后续有垂直通道）
        // 或直接写入 destinationTextureView（如果只做水平模糊）
        // =================================================================
        if(this.doHorizontalPass)
        {
            // 确定水平通道的输出目标：
            // 如果还要执行垂直通道，则输出到 verticalPassRenderTexture 作为垂直通道的输入
            // 否则直接输出到最终目标
            const textureView = this.doVerticalPass ? 
                this.verticalPassRenderTexture.texture.createView() : 
                destinationTextureView

            const commandEncoder = this.device.createCommandEncoder();
            const passEncoder = commandEncoder.beginRenderPass({
                colorAttachments: [
                    {
                        view: textureView,
                        loadOp: "clear",
                        storeOp: "store",
                    }
                ]
            });

            passEncoder.setPipeline(this.horizontalPassPipeline);
            passEncoder.setVertexBuffer(0, this.gpuBuffer);
            // 采样 horizontalPassRenderTexture 进行水平模糊
            passEncoder.setBindGroup(0, this.horizontalPassBindGroup);
            passEncoder.draw(6, 1, 0, 0);

            passEncoder.end();
            this.device.queue.submit([commandEncoder.finish()]);
        }

        // =================================================================
        // 垂直模糊通道（VERTICAL PASS）
        // 从 verticalPassRenderTexture 采样，垂直方向模糊，
        // 结果写入最终的 destinationTextureView
        // =================================================================
        if(this.doVerticalPass)
        {
            const commandEncoder = this.device.createCommandEncoder();
            const passEncoder = commandEncoder.beginRenderPass({
                colorAttachments: [
                    {
                        view: destinationTextureView,
                        loadOp: "clear",
                        storeOp: "store",
                    }
                ]
            });

            passEncoder.setPipeline(this.verticalPassPipeline);
            passEncoder.setVertexBuffer(0, this.gpuBuffer);
            // 采样 verticalPassRenderTexture（水平模糊的结果）进行垂直模糊
            passEncoder.setBindGroup(0, this.verticalPassBindGroup);
            passEncoder.draw(6, 1, 0, 0);

            passEncoder.end();
            this.device.queue.submit([commandEncoder.finish()]);
        }
    }
}
