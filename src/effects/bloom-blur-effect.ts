/**
 * BloomBlurEffect - 泛光专用模糊效果类（乒乓渲染）
 *
 * 【乒乓渲染（Ping-Pong Rendering）概述】
 * 乒乓渲染是后处理中一种常用的多通道渲染技术，特别适用于需要多次迭代的效果（如多次模糊）。
 *
 * 核心思想：使用两个纹理交替作为输入和输出：
 *   ┌─────────────┐     ┌─────────────┐
 *   │  纹理 A      │ ──→ │  纹理 B      │  通道 1: A → B
 *   │ (外部纹理)    │ ←── │ (pingPong)   │  通道 2: B → A
 *   └─────────────┘     └─────────────┘
 *         ↑                    ↓
 *         └────────────────────┘
 *
 * 【本类的乒乓渲染实现】
 * 本类使用的两个纹理是：
 *   1. 外部传入的 textureToApplyEffectTo（通常是 BloomEffect 中的 brightnessTexture）
 *   2. 内部的 pingPongTexture（专门用于乒乓渲染的中间纹理）
 *
 * 每次 draw() 调用执行两个通道：
 *   水平通道：textureToApplyEffectTo → [水平模糊] → pingPongTexture
 *   垂直通道：pingPongTexture         → [垂直模糊] → textureToApplyEffectTo
 *
 * 经过一次 draw() 调用后，结果又回到了 textureToApplyEffectTo 中，
 * 因此可以连续多次调用 draw() 来实现多次迭代模糊。
 *
 * 【与 BlurEffect 的区别】
 *   BlurEffect:     拥有两个独立的渲染纹理，自身的纹理既是输入也是输出
 *   BloomBlurEffect: 只有一个内部 pingPongTexture，与外部纹理配合实现乒乓渲染
 *                    更加节省显存（只需一个额外纹理），且适合多次迭代
 */

import { BufferUtil } from "../utils/buffer-util";
import { Texture } from "../core/texture";
import shaderSource from "../shaders/blur-effect.wgsl?raw"

export class BloomBlurEffect {

    /**
     * 水平模糊渲染管线——片段着色器沿 x 轴方向采样
     */
    private horizontalPassPipeline!: GPURenderPipeline;

    /**
     * 垂直模糊渲染管线——片段着色器沿 y 轴方向采样
     */
    private verticalPassPipeline!: GPURenderPipeline;

    // =====================================================================
    // 乒乓纹理及其绑定组
    //
    // pingPongTexture 是乒乓渲染的核心：
    //   - 在水平通道中作为输出目标（接收外部纹理的水平模糊结果）
    //   - 在垂直通道中作为输入源（采样此纹理进行垂直模糊）
    //
    // pingPongBindGroup 将 pingPongTexture 绑定为着色器的采样源
    // （仅在垂直通道中使用）
    // =====================================================================
    private pingPongTexture!: Texture;
    private pingPongBindGroup!: GPUBindGroup;

    /**
     * 创建模糊渲染管线（水平或垂直）。
     * 与 BlurEffect.createPipeline() 完全相同的实现。
     *
     * @param shaderSource          - WGSL 着色器代码
     * @param textureBindGroupLayout - 纹理绑定组布局
     * @param horizontal            - true=水平管线, false=垂直管线
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
                // 选择水平或垂直方向的片段着色器入口
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
     * 全屏四边形顶点缓冲区
     */
    private gpuBuffer!: GPUBuffer;


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
     * 初始化泛光模糊效果的所有 GPU 资源。
     * 与 BlurEffect 不同，这里只创建一个内部纹理（pingPongTexture），
     * 而非两个独立的渲染纹理。
     */
    public async initialize() {
        // 创建乒乓纹理——仅此一个内部纹理
        // 它在水平通道中作为输出目标，在垂直通道中作为输入源
        this.pingPongTexture = await Texture.createEmptyTexture(this.device, this.width, this.height, "bgra8unorm");

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

        // 绑定组布局：采样器 + 纹理（与 BlurEffect 相同）
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
        // 乒乓纹理绑定组：将 pingPongTexture 绑定到着色器的 @group(0)
        // 用于垂直通道——从 pingPongTexture 采样水平模糊的结果
        // =====================================================================
        this.pingPongBindGroup = this.device.createBindGroup({
            layout: textureBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: this.pingPongTexture.sampler
                },
                {
                    binding: 1,
                    resource: this.pingPongTexture.texture.createView()
                }
            ]
        });


        // 创建水平和垂直两条模糊管线
        this.horizontalPassPipeline = this.createPipeline(shaderSource, textureBindGroupLayout, true);
        this.verticalPassPipeline = this.createPipeline(shaderSource, textureBindGroupLayout, false);
    }

    /**
     * 执行一次乒乓模糊迭代。
     *
     * 【乒乓渲染详细流程】
     *
     * ┌──────────────────────────────────────────────────────────────┐
     * │  水平通道（Horizontal Pass）                                 │
     * │                                                              │
     * │  输入源: textureToApplyEffectTo (外部亮度纹理)               │
     * │  着色器: fragmentMainHorizontal (沿 x 轴高斯采样)            │
     * │  输出目标: pingPongTexture (内部乒乓纹理)                    │
     * │                                                              │
     * │  external texture → [水平模糊] → pingPongTexture            │
     * └──────────────────────────────────────────────────────────────┘
     *                              ↓
     * ┌──────────────────────────────────────────────────────────────┐
     * │  垂直通道（Vertical Pass）                                   │
     * │                                                              │
     * │  输入源: pingPongTexture (水平模糊的结果)                    │
     * │  着色器: fragmentMainVertical (沿 y 轴高斯采样)              │
     * │  输出目标: textureToApplyEffectTo (写回外部纹理)             │
     * │                                                              │
     * │  pingPongTexture → [垂直模糊] → external texture             │
     * └──────────────────────────────────────────────────────────────┘
     *
     * 一次 draw() 调用完成后，结果又回到了 textureToApplyEffectTo，
     * 外部（BloomEffect）可以连续调用 draw() 多次来实现多次迭代。
     *
     * 【关于纹理读写的安全性】
     * WebGPU 不允许同一个纹理在同一个渲染通道中同时作为输入和输出。
     * 乒乓渲染通过引入中间纹理（pingPongTexture）来解决这个问题：
     *   - 水平通道读外部纹理 → 写 pingPongTexture（两者不同，安全）
     *   - 垂直通道读 pingPongTexture → 写外部纹理（两者不同，安全）
     *
     * @param textureToApplyEffectTo              - 外部纹理视图（亮度纹理），作为水平通道输入和垂直通道输出
     * @param textureToApplyEffectToBindGroup     - 外部纹理的绑定组，用于水平通道采样
     */
    public draw(textureToApplyEffectTo: GPUTextureView, textureToApplyEffectToBindGroup: GPUBindGroup) {

        // =================================================================
        // 水平模糊通道（HORIZONTAL PASS）
        // 从外部纹理采样，水平方向进行高斯模糊
        // 结果写入内部的 pingPongTexture
        // =================================================================
        const horizontalCommandEncoder = this.device.createCommandEncoder();
        const horizontalPassEncoder = horizontalCommandEncoder.beginRenderPass({
            colorAttachments: [
                {
                    // 输出目标：乒乓纹理（不是外部纹理）
                    view: this.pingPongTexture.texture.createView(),
                    loadOp: "clear",
                    storeOp: "store",
                }
            ]
        });

        horizontalPassEncoder.setPipeline(this.horizontalPassPipeline);
        horizontalPassEncoder.setVertexBuffer(0, this.gpuBuffer);
        // 绑定外部纹理作为采样源——从中读取亮度数据
        horizontalPassEncoder.setBindGroup(0, textureToApplyEffectToBindGroup);
        horizontalPassEncoder.draw(6, 1, 0, 0);

        horizontalPassEncoder.end();
        this.device.queue.submit([horizontalCommandEncoder.finish()]);


        // =================================================================
        // 垂直模糊通道（VERTICAL PASS）
        // 从 pingPongTexture（水平模糊的结果）采样，垂直方向进行高斯模糊
        // 结果写回外部纹理 textureToApplyEffectTo
        // =================================================================
        const verticalCommandEncoder = this.device.createCommandEncoder();
        const verticalPassEncoder = verticalCommandEncoder.beginRenderPass({
            colorAttachments: [
                {
                    // 输出目标：外部纹理（写回亮度纹理）
                    view: textureToApplyEffectTo,
                    loadOp: "clear",
                    storeOp: "store",
                }
            ]
        });

        verticalPassEncoder.setPipeline(this.verticalPassPipeline);
        verticalPassEncoder.setVertexBuffer(0, this.gpuBuffer);
        // 绑定乒乓纹理作为采样源——从中读取水平模糊的中间结果
        verticalPassEncoder.setBindGroup(0, this.pingPongBindGroup);
        verticalPassEncoder.draw(6, 1, 0, 0);

        verticalPassEncoder.end();
        this.device.queue.submit([verticalCommandEncoder.finish()]);

    }
}
