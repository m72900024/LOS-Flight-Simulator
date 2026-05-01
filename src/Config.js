export const FLIGHT_MODES = { ACRO: 0, ANGLE: 1, HORIZON: 2, ALT_HOLD: 3 };

// 難度預設值：影響角速度、最大傾角、油門曲線
export const DIFFICULTY_PRESETS = {
    beginner: { rates: 0.30, superRate: 0.0, maxTiltAngle: 20, thrustExpo: 0.6 },
    normal:   { rates: 0.80, superRate: 0.3, maxTiltAngle: 40, thrustExpo: 0.4 },
    expert:   { rates: 1.20, superRate: 0.7, maxTiltAngle: 55, thrustExpo: 0.3 },
};

export const CONFIG = {
    gravity: 9.81, mass: 0.6, maxThrust: 28.0, dragCoeff: 0.015,
    angularDrag: 15, hardDeck: 0.05, maxHeight: 50,
    thrustPower: 24, thrustExpo: 0.6, rates: 0.30, superRate: 0.0,
    maxTiltAngle: 20, droneScale: 3.0,
    // 難度預設：'beginner' | 'normal' | 'expert'，新手最溫和
    difficulty: 'beginner',
    // 'centering' = 遊戲手把（油門初值 0.5、預設 ALT_HOLD）；'rc' = 不置中飛手桿（油門 0、預設 ANGLE）
    joystickType: 'centering',
    axes: { thrust: 1, yaw: 0, pitch: 2, roll: 5, arm: -1, mode: -1 },
    invert: { t: false, r: false, e: false, a: false },
    calibration: { roll: 0, pitch: 0, yaw: 0, thrust: 0 },
    endpoints: {
        thrust: { min: -1, max: 1 }, yaw: { min: -1, max: 1 },
        pitch: { min: -1, max: 1 }, roll: { min: -1, max: 1 }
    },
    levels: [
        { id:1, name:'起飛定高', desc:'起飛到 2~3m 高度維持 3 秒' },
        { id:2, name:'定點懸停', desc:'在綠色方框內懸停 3 秒' },
        { id:3, name:'前後平移', desc:'飛到前方再飛回來' },
        { id:4, name:'左右平移', desc:'飛到左方再到右方' },
        { id:5, name:'矩形航線', desc:'依序通過 4 個航點' },
        { id:6, name:'穿越拱門', desc:'穿越前方拱門' },
        { id:7, name:'8字飛行', desc:'繞兩柱子畫 8 字' },
        { id:8, name:'模擬考試', desc:'台灣無人機基本級術科模擬（定點起降＋矩形航線）' }
    ]
};
