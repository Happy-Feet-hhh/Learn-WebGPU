// =============================================================================
// WGSL 模糊效果着色器 — 可分离高斯模糊 (Blur Effect: Separable Gaussian Blur)
// =============================================================================
//
// 【高斯模糊原理】
// 高斯模糊是最常用的图像模糊算法，基于高斯分布（正态分布）函数。
// 二维高斯模糊的朴素实现需要对每个像素进行 O(n²) 次采样（n 为卷积核大小）。
//
// 【可分离性优化】
// 二维高斯函数具有"可分离"（Separable）的数学性质：
//   G(x, y) = G(x) × G(y)
// 因此可以将一个 O(n²) 的 2D 卷积分解为两个 O(n) 的 1D 卷积：
//   第一遍：水平方向模糊 (fragmentMainHorizontal)
//   第二遍：垂直方向模糊 (fragmentMainVertical)
// 总复杂度从 O(n²) 降低到 O(2n)，大幅提升性能。
//
// 【本文件实现】
// 使用 9-tap（9 次采样）的高斯模糊核。
// 由于高斯核是对称的，只需要存储 5 个权重值：
//   - weights[0]: 中心像素权重（采样 1 次）
//   - weights[1~4]: 两侧对称像素的权重（各采样 2 次，左+右）
// 总采样次数 = 1 + 4×2 = 9 次
//
// 【渲染流程】
// 原始纹理 → 水平模糊 → 中间纹理 → 垂直模糊 → 最终模糊结果
// =============================================================================

// ---------------------------------------------------------------------------
// 顶点着色器输出结构体
// ---------------------------------------------------------------------------
// 与其他后处理着色器相同，使用全屏四边形进行后处理
struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0) texCoords: vec2f
}

// ---------------------------------------------------------------------------
// 顶点着色器入口函数
// ---------------------------------------------------------------------------
// 后处理管线的标准顶点着色器：直接传递全屏四边形的 NDC 坐标
@vertex 
fn vertexMain(
    @location(0) pos: vec2f,
    @location(1) texCoords: vec2f,
) -> VertexOut 
{ 
    var output : VertexOut; 

    // 全屏四边形坐标已在 NDC 空间，直接赋值
    output.position = vec4f(pos, 0.0, 1.0);
    output.texCoords = texCoords;

    return output;
}

// ---------------------------------------------------------------------------
// 片段着色器资源绑定
// ---------------------------------------------------------------------------
@group(0) @binding(0)
var texSampler: sampler;

@group(0) @binding(1)
var tex: texture_2d<f32>;

// ---------------------------------------------------------------------------
// 高斯模糊核权重
// ---------------------------------------------------------------------------
// var<private> — 私有存储地址空间，每个片段着色器调用都有独立的副本
//
// 这些是预计算的高斯权重值，5 个权重对应 9-tap 高斯核：
//
//   weights[0] = 0.204164 → 中心像素（1 次采样）
//   weights[1] = 0.180174 → 距中心 ±1 像素（2 次采样）
//   weights[2] = 0.123832 → 距中心 ±2 像素（2 次采样）
//   weights[3] = 0.066282 → 距中心 ±3 像素（2 次采样）
//   weights[4] = 0.027631 → 距中心 ±4 像素（2 次采样）
//
// 所有权重之和（考虑对称采样）：
//   = 0.204164 + 2×(0.180174 + 0.123832 + 0.066282 + 0.027631)
//   ≈ 1.0（归一化，保证模糊后亮度不变）
//
// 越靠近中心像素权重越大，符合高斯分布特征
var<private> weights: array<f32, 5> = array(
    0.204163688,
    0.180173822,
    0.123831536, 
    0.066282245, 
    0.027630550
);

// ---------------------------------------------------------------------------
// 水平模糊片段着色器
// ---------------------------------------------------------------------------
// 沿水平方向（X 轴）进行 1D 高斯模糊
// 这是可分离高斯模糊的第一遍处理
@fragment
fn fragmentMainHorizontal(fragData: VertexOut ) -> @location(0) vec4f 
{
    // textureDimensions(tex) 返回纹理的像素尺寸 (width, height)
    // 1.0 / width = 一个纹素（texel）在纹理坐标空间中的宽度
    // 这是采样时的偏移量单位，确保恰好偏移整数个像素
    var horizontalTexel = 1.0 / f32(textureDimensions(tex).x);

    // 中心像素采样：权重最大，只采样一次
    var result  = textureSample(tex, texSampler, fragData.texCoords) * weights[0];

    // 对称采样循环：i 从 1 到 4
    // 每次迭代在当前像素的左右两侧各采样一个点
    for(var i = 1; i < 5; i++)
    {
        // 计算水平偏移量 = i 个纹素的宽度
        var offset = vec2f(horizontalTexel * f32(i), 0.0);

        // 右侧采样坐标：当前纹理坐标 + 偏移
        var sampleCoordsRight = fragData.texCoords + offset;
        // 左侧采样坐标：当前纹理坐标 - 偏移
        var sampleCoordsLeft = fragData.texCoords - offset;

        // 对称采样：左右两侧使用相同权重，累加到结果中
        result += textureSample(tex, texSampler, sampleCoordsRight) * weights[i];
        result += textureSample(tex, texSampler, sampleCoordsLeft) * weights[i];
    }

    // 输出模糊结果，alpha 固定为 1.0
    return vec4f(result.xyz, 1.0);
}

// ---------------------------------------------------------------------------
// 垂直模糊片段着色器
// ---------------------------------------------------------------------------
// 沿垂直方向（Y 轴）进行 1D 高斯模糊
// 这是可分离高斯模糊的第二遍处理
// 逻辑与水平模糊完全相同，只是偏移方向从 X 改为 Y
@fragment
fn fragmentMainVertical(fragData: VertexOut ) -> @location(0) vec4f 
{
    // 计算垂直方向上一个纹素的高度
    var verticalTexel = 1.0 / f32(textureDimensions(tex).y);

    // 中心像素采样
    var result  = textureSample(tex, texSampler, fragData.texCoords) * weights[0];

    // 对称采样循环
    for(var i = 1; i < 5; i++)
    {
        // 计算垂直偏移量 = i 个纹素的高度
        var offset = vec2f(0.0, verticalTexel * f32(i));

        // 上方和下方采样坐标
        var sampleCoordsUp = fragData.texCoords + offset;
        var sampleCoordsDown = fragData.texCoords - offset;

        // 对称采样：上下两侧使用相同权重
        result += textureSample(tex, texSampler, sampleCoordsUp) * weights[i];
        result += textureSample(tex, texSampler, sampleCoordsDown) * weights[i];
    }

    // 输出模糊结果，alpha 固定为 1.0
    return vec4f(result.xyz, 1.0);
}
