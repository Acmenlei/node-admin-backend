const express = require('express');
const router = express.Router();
const {
    SELECT_STUDENTINFO,
    INSERT_STUDENTINFO,
    SELECT_PASSWORD
} = require("../sql/student"); // sql语句
const {
    TOKEN_IS_UNDEFINED,
    TOKEN_IS_EXPIRESE,
    REGISTER_FAILURE,
    REGISTER_OK,
    LOGIN_OUT,
    NETWORK_ERROR,
    LOGIN_FAILED,
    LOGIN_OK,
    USERNAME_IS_NULL,
    REGISTER_IS_EXISTS
} = require('../common/tip/tip'); // 提示信息
const { TOKEN, TOKEN_VERIFY } = require("../common/token/verify");
const RedisClient = require('../connect/redis');
const SQLQuery = require("../query/query");
const MySQL = require('../connect/mysql');
const { GenerateToken, VerifyToken } = require("../authentication/token");
const { AES, AESparse } = require("../authentication/hash");

/* 注册操作 */
router.post('/register', (request, response) => {
    const { username, password } = request.body;
    const HASH_STRING = AES(password); // 加密密码
    SQLQuery({ sql: INSERT_STUDENTINFO, values: [username, HASH_STRING] }, (error) => {
        new Promise((resolve, reject) => {
            error ? reject(error.message) : resolve(REGISTER_OK);
        })
        .then(statusMsg => {
            GenerateToken({ username }, "10h").then(hash => {
                response.setHeader(TOKEN, hash) // 设置token
                RedisClient.SETEX(TOKEN, 60 * 60 * 10, hash) // 设置有效时间为10小时
                return response.json({ code: 1, list: statusMsg });
            })
            .catch(_ => {
                return response.json({ code: -95, msg: REGISTER_FAILURE })
            })
        })
        .catch(_ => {
            // 账户已存在的情况
            return response.json({ code: -96, msg: REGISTER_IS_EXISTS });
        })
        .finally(() => MySQL.close()) // 关闭链接
    })
})

/* 退出登陆操作 */
router.post("/loginout", (req, response) => {
    const { token } = req.headers;
    if (TOKEN_VERIFY(token)) { // token未携带或者redis查询该token不存在 返回非法操作
        return response.json({ code: -99, msg: TOKEN_IS_UNDEFINED });
    }
    RedisClient.del(TOKEN); // 删除token, 客户端的token将失效
    return response.json({ code: 200, msg: LOGIN_OUT })
})

/* 登陆操作 (登陆是不存在token的) */
router.post('/login', (req, resp) => {
    const { username, password } = req.body;
    // 查找该username的所属密码
    SQLQuery({ sql: SELECT_PASSWORD, values: [username] }, (error, result) => {
        new Promise((resolve, reject) => {
            error ? reject(error.message) : resolve(result);
    })
    .then(data => {
        const { pass_word } = data[0]
        if (AESparse(pass_word) === password) {
            return resp.json({ code: 66, msg: LOGIN_OK })
        }
        return resp.json({ code: -65, MSG: LOGIN_FAILED })
    })
    .catch(_ => {
        let reason = _.message.includes('undefined'); // 查到的是一个空的list
        return reason ? resp.json({ code: -77, msg: USERNAME_IS_NULL }) : 
               resp.json({ code: -78, msg: NETWORK_ERROR })
    })
    .finally(() => MySQL.close())
})
})

/* 获取学生用户信息集合 */
router.get('/studentInfo', async (request, response) => {
    const { token } = request.headers;
    if (TOKEN_VERIFY(token)) { // token未携带或者redis查询该token不存在 返回非法操作
        return response.json({ code: -99, msg: TOKEN_IS_UNDEFINED });
    }
    try {
        await VerifyToken(token) // 验证token是否合格
        SQLQuery({ sql: SELECT_STUDENTINFO }, (error, result) => {
            new Promise((resolve, reject) => {
                error ? reject(error.message) : resolve(result);
        })
        .then(result => {
            return response.json({ code: 1, list: result });
        })
        .catch(reason => {
            return response.json({ code: -1, msg: reason });
        })
        .finally(() => MySQL.close())
        })
    } catch (e) {
        return e.msg === 'TokenExpiredError' ? 
        response.json({ code: -888, msg: TOKEN_IS_EXPIRESE }) : // token过期的情况
        response.json({ code: -999, msg: TOKEN_IS_UNDEFINED }); // token错误的情况
    }
})

module.exports = router;