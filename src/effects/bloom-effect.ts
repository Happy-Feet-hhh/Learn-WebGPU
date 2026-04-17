/**
 * BloomEffect - 泛光（辉光）效果类
 *
 * 【泛光效果（Bloom Effect）概述】
 * 泛光是游戏和实时渲染中广泛使用的后处理特效，模拟真实世界中强光源产生的光晕扩散效果。
 * 当摄像机或人眼看到非常明亮的物体时，光线会"溢出"到周围区域，产生柔和的辉光。
 *
 * 【泛光管线流程】
 * 本类实现了经典的泛光三步管线：
 *
 *   步骤 1：场景渲染
 *     3D 场景 → sceneTexture（完整场景图像）
 *     同时 → brightnessTexture（仅包含高亮区域，由着色器中的亮度提取完成）
 *
 *   步骤 2：多迭代模糊
 *     brightnessTexture → [水平模糊 + 垂直模糊] × 10 次 → blurred brightnessTexture
 *     每次迭代都在上一次模糊的基础上进一步模糊，使光芒扩散得更远、更柔和。
 *     多次迭代的叠加效果等价于一次更大半径的模糊。
 *
 *   步骤 3：合成
 *     sceneTexture + blurred brightnessTexture → 最终输出
 *     着色器将原始场景颜色和模糊后的高亮区域相加，产生泛光效果。
 *
 * 【为什么需要多次模糊迭代？】
 *   - 单次模糊的扩散范围有限
 *   - 多次迭代可以扩大模糊半径，同时保持平滑的衰减
 *   - 每次迭代使用乒乓渲染技术，在两个纹理之间交替读写
 *   - BloomBlurEffect 内部使用 pingPongTexture 实现这一点
 *
 * 【数据流图】
 *   场景渲染 ──┬──→ sceneTexture ──────────────────────┐
 *              │                                         │
 *              └──→ brightnessTexture → [Blur×10] ──→ 合成 → 输出
 *                                      (BloomBlurEffect
 *                                       乒乓渲染)
 */

import { BufferUtil } from "../utils/buffer-util";
import { Texture } from "../core/texture";
import shaderSource from "../shaders/bloom-effect.wgsl?raw"
import { BloomBlurEffect } from "./bloom-blur-effect";

export class BloomEffect {
    private gpuPipeline!: GPURenderPipeline;
    private gpuBuffer!: GPUBuffer; // vertex buffer

    // =====================================================================
    // 场景纹理：存放完整的 3D 场景渲染结果（包含所有明暗区域）
    // 外部将场景同时渲染到此纹理和 brightnessTexture
    // =====================================================================
    public sceneTexture!: Texture;
    private sceneTextureBindGroup!: GPUBindGroup;

    // =====================================================================
    // 亮度纹理：仅包含场景中高亮区域的像素
    // 着色器会提取超过亮度阈值的像素，只保留明亮部分
    // 这个纹理随后会被反复模糊，产生柔和的光晕
    // =====================================================================
    public brightnessTexture!: Texture;
    private brightnessTextureBindGroup!: GPUBindGroup;

    /**
     * 泛光模糊效果——对亮度纹理执行多迭代的双通道高斯模糊。
     * 内部使用乒乓渲染技术，在 brightnessTexture 和 pingPongTexture 之间交替。
     */
    private blurEffect!: BloomBlurEffect;

    /**
     * 构造函数
     * @param device - GPU 设备
     * @param width  - 渲染目标宽度
     * @param height - 渲染目标高度
     */
    constructor(private device: GPUDevice,
        public width: number,
        public height: number) {

    }


    /**
     * 初始化泛光效果的所有 GPU 资源。
     */
    public async initialize() {
        // =====================================================================
        // 创建两张渲染纹理：
        //   sceneTexture:      完整的场景图像（所有像素）
        //   brightnessTexture: 仅高亮区域（亮度超过阈值的像素）
        //
        // 外部渲染时，场景被同时渲染到这两个纹理：
        //   - sceneTexture 使用普通渲染管线
        //   - brightnessTexture 使用亮度提取着色器（阈值过滤）
        // =====================================================================
        this.sceneTexture = await Texture.createEmptyTexture(this.device, this.width, 
            this.height, "bgra8unorm");
        this.brightnessTexture = await Texture.createEmptyTexture(this.device, this.width, 
            this.height, "bgra8unorm");

        // 全屏四边形顶点缓冲区
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
        // 纹理绑定组布局：采样器(binding 0) + 纹理(binding 1)
        // 注意：sceneTexture 和 brightnessTexture 共用同一个布局对象，
        // 因为它们的绑定结构完全相同。
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
        // 创建绑定组实例
        // =====================================================================

        // 场景纹理绑定组 → @group(0)：片段着色器从中采样原始场景颜色
        this.sceneTextureBindGroup = this.device.createBindGroup({
            layout: textureBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: this.sceneTexture.sampler
                },
                {
                    binding: 1,
                    resource: this.sceneTexture.texture.createView()
                }
            ]
        });

        // 亮度纹理绑定组 → @group(1)：片段着色器从中采样模糊后的亮度数据
        this.brightnessTextureBindGroup = this.device.createBindGroup({
            layout: textureBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: this.brightnessTexture.sampler
                },
                {
                    binding: 1,
                    resource: this.brightnessTexture.texture.createView()
                }
            ]
        });


        // 创建着色器模块（bloom-effect.wgsl 包含合成着色器）
        const shaderModule = this.device.createShaderModule({
            code: shaderSource
        });

        // =====================================================================
        // 【泛光合成管线】
        // 管线布局包含两个绑定组：
        //   @group(0) = textureBindGroupLayout → sceneTexture（原始场景）
        //   @group(1) = textureBindGroupLayout → brightnessTexture（模糊后的高亮区域）
        //
        // 片段着色器的工作：
        //   finalColor = texture(sceneTexture, uv) + texture(brightnessTexture, uv)
        // 即将原始场景和模糊高亮区域相加，产生泛光效果
        // =====================================================================
        const desc: GPURenderPipelineDescriptor = {
            layout: this.device.createPipelineLayout({
                bindGroupLayouts: [
                    textureBindGroupLayout, // group(0)
                    textureBindGroupLayout, // group(1)
                ]
            }),
            vertex: {
                module: shaderModule,
                entryPoint: "vertexMain",
                buffers: [
                    {
                        arrayStride: 4 * Float32Array.BYTES_PER_ELEMENT,
                        attributes: [
                            {
                                shaderLocation: 0,
                                offset: 0,
                                format: "float32x2"
                            },
                            {
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
                entryPoint: "fragmentMain",
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

        this.gpuPipeline = this.device.createRenderPipeline(desc);

        // =====================================================================
        // 初始化泛光模糊效果
        // BloomBlurEffect 专门为泛光设计，使用乒乓渲染在 brightnessTexture
        // 和内部 pingPongTexture 之间交替进行水平+垂直模糊
        // =====================================================================
        this.blurEffect = new BloomBlurEffect(this.device, this.width, this.height);
        await this.blurEffect.initialize();
    }

    /**
     * 执行完整的泛光效果管线。
     *
     * 【执行流程】
     * 1. 对 brightnessTexture 执行 10 次双通道高斯模糊（使用 BloomBlurEffect）
     *    每次调用的数据流：
     *      brightnessTexture → [水平模糊] → pingPongTexture → [垂直模糊] → brightnessTexture
     *    经过 10 次迭代后，brightnessTexture 中存储了高度模糊的高亮区域
     *
     * 2. 合成：将 sceneTexture 和模糊后的 brightnessTexture 叠加
     *    着色器中：finalColor = sceneColor + blurredBrightnessColor
     *
     * 【关于多次模糊迭代】
     *   迭代次数越多，泛光扩散范围越大，效果越柔和。
     *   10 次是一个典型的值，可以在视觉效果和性能之间取得平衡。
     *   每次迭代包括一次水平通道和一次垂直通道（在 BloomBlurEffect 内部完成）。
     *
     * @param destinationTextureView - 最终输出目标纹理视图（通常是屏幕）
     */
    public draw(destinationTextureView: GPUTextureView) {

        // =================================================================
        // 步骤 1：对亮度纹理进行 10 次模糊迭代
        // 每次迭代：brightnessTexture ↔ pingPongTexture（乒乓渲染）
        //
        // 【乒乓渲染过程】（每次 draw 调用）
        //   水平通道：brightnessTexture → [水平模糊] → pingPongTexture
        //   垂直通道：pingPongTexture   → [垂直模糊] → brightnessTexture
        //
        // 10 次迭代后，brightnessTexture 中存储了充分模糊的亮度数据
        // =================================================================
        this.blurEffect.draw(this.brightnessTexture.texture.createView(), this.brightnessTextureBindGroup);
        this.blurEffect.draw(this.brightnessTexture.texture.createView(), this.brightnessTextureBindGroup);
        this.blurEffect.draw(this.brightnessTexture.texture.createView(), this.brightnessTextureBindGroup);
        this.blurEffect.draw(this.brightnessTexture.texture.createView(), this.brightnessTextureBindGroup);
        this.blurEffect.draw(this.brightnessTexture.texture.createView(), this.brightnessTextureBindGroup);
        this.blurEffect.draw(this.brightnessTexture.texture.createView(), this.brightnessTextureBindGroup);
        this.blurEffect.draw(this.brightnessTexture.texture.createView(), this.brightnessTextureBindGroup);
        this.blurEffect.draw(this.brightnessTexture.texture.createView(), this.brightnessTextureBindGroup);
        this.blurEffect.draw(this.brightnessTexture.texture.createView(), this.brightnessTextureBindGroup);
        this.blurEffect.draw(this.brightnessTexture.texture.createView(), this.brightnessTextureBindGroup);


        // =================================================================
        // 步骤 2：合成最终图像
        // 将原始场景（sceneTexture）和模糊后的高亮区域（brightnessTexture）叠加
        //
        // @group(0) = sceneTexture      → 原始场景颜色
        // @group(1) = brightnessTexture  → 模糊后的高亮区域（泛光）
        //
        // 着色器执行：result = scene_color + bloom_color
        // =================================================================
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

        passEncoder.setPipeline(this.gpuPipeline);
        passEncoder.setVertexBuffer(0, this.gpuBuffer);
        passEncoder.setBindGroup(0, this.sceneTextureBindGroup);
        passEncoder.setBindGroup(1, this.brightnessTextureBindGroup);
        passEncoder.draw(6, 1, 0, 0);

        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
    }
}
