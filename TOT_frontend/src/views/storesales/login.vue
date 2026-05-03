<template>
  <div class="emp-login">
    <div class="emp-login__card">
      <div class="emp-login__brand">
        <img :src="websiteConfig.loginImage" alt="" class="emp-login__logo" />
        <h1 class="emp-login__title">TOT-店员登录</h1>
        <p class="emp-login__sub">请使用官方员工邮箱登录</p>

        <!-- 假数据提醒小字 -->
        <div class="emp-login__mock">
          <p>温馨提示：请使用下发至您 MyPal 的工作邮箱登录测试：</p>
          <p>• Monobrand 店员：e001@mypal.seed.local</p>
          <p>• Multibrand 店员：e007@mypal.seed.local</p>
          <p>• Carrier 店员：e013@mypal.seed.local</p>
          <p>• Education 店员：e019@mypal.seed.local</p>
          <p>• Enterprise 店员：e025@mypal.seed.local</p>
        </div>
      </div>

      <n-form ref="formRef" :model="form" :rules="rules" size="large" class="emp-login__form">
        <n-form-item path="email">
          <n-input
            v-model:value="form.email"
            type="text"
            inputmode="email"
            autocomplete="username"
            placeholder="请输入邮箱"
            :disabled="loading"
            @keyup.enter="handleSubmit"
          />
        </n-form-item>
        <n-button
          type="primary"
          block
          :loading="loading"
          class="emp-login__btn"
          @click="handleSubmit"
        >
          登录
        </n-button>
      </n-form>
    </div>
  </div>
</template>

<script lang="ts" setup>
  import { reactive, ref } from 'vue';
  import { useRoute, useRouter } from 'vue-router';
  import { useMessage } from 'naive-ui';
  import { useUserStore } from '@/store/modules/user';
  import { ResultEnum } from '@/enums/httpEnum';
  import { websiteConfig } from '@/config/website.config';
  import { HQ_ENTRY_KEY } from '@/constants/entry';

  const formRef = ref();
  const loading = ref(false);
  const message = useMessage();
  const userStore = useUserStore();
  const router = useRouter();
  const route = useRoute();

  const form = reactive({
    email: '',
  });

  const rules = {
    email: [
      {
        validator: (_rule, value: string) => {
          if (!value?.trim()) return new Error('请输入邮箱');
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
            return new Error('邮箱格式不正确');
          }
          return true;
        },
        trigger: ['blur', 'input'],
      },
    ],
  };

  const handleSubmit = (e?: Event) => {
    e?.preventDefault();
    formRef.value?.validate(async (errors) => {
      if (errors) return;
      loading.value = true;
      message.loading('登录中…');
      try {
        const email = form.email.trim();
        sessionStorage.removeItem(HQ_ENTRY_KEY);
        // 使用占位密码应对后端接口格式要求，当前仅使用邮箱即可判定身份
        const { code, message: msg } = await userStore.login({
          username: email,
          password: 'dummy_password',
          email,
        });
        message.destroyAll();
        if (code !== ResultEnum.SUCCESS) {
          message.warning(msg || '未查询到该店员信息，登录失败');
          return;
        }
        const role = userStore.getUserInfo?.role;
        if (role === 'employee') {
          const redirect = (route.query.redirect as string) || '/storesales';
          router.replace(decodeURIComponent(redirect));
          return;
        }
        message.info('请使用店员账号登录');
        await userStore.logout();
      } finally {
        loading.value = false;
      }
    });
  };
</script>

<style lang="less" scoped>
  .emp-login {
    min-height: 100vh;
    min-height: 100dvh;
    padding: 24px 20px 32px;
    box-sizing: border-box;
    background: linear-gradient(165deg, #e8f1fa 0%, #c8daf0 45%, #a8c4e6 100%);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: max(24px, env(safe-area-inset-top));
    padding-bottom: max(32px, env(safe-area-inset-bottom));
  }

  .emp-login__card {
    width: 100%;
    max-width: 400px;
    margin-top: 8vh;
    padding: 28px 22px 32px;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.92);
    box-shadow: 0 12px 40px rgba(30, 60, 90, 0.12);
  }

  .emp-login__brand {
    text-align: center;
    margin-bottom: 28px;
  }

  .emp-login__logo {
    width: 56px;
    height: 56px;
    object-fit: contain;
    margin-bottom: 12px;
  }

  .emp-login__title {
    margin: 0 0 8px;
    font-size: 22px;
    font-weight: 600;
    color: #1a2b3c;
  }

  .emp-login__sub {
    margin: 0 0 16px;
    font-size: 13px;
    color: #64748b;
    line-height: 1.5;
  }

  .emp-login__mock {
    margin-top: 12px;
    background: rgba(232, 241, 250, 0.6);
    padding: 12px;
    border-radius: 8px;
    font-size: 12px;
    color: #475569;
    text-align: left;
    p {
      margin: 4px 0;
      line-height: 1.4;
    }
  }

  .emp-login__form {
    :deep(.n-form-item) {
      margin-bottom: 18px;
    }
  }

  .emp-login__btn {
    margin-top: 8px;
    height: 46px;
    font-size: 16px;
    border-radius: 10px;
  }
</style>
