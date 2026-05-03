<template>
  <div class="executive-login">
    <div class="executive-login__card">
      <div class="executive-login__brand">
        <img :src="websiteConfig.loginImage" alt="" class="executive-login__logo" />
        <h1 class="executive-login__title">TOT - Executive Chat</h1>
        <p class="executive-login__sub">请使用您的专属主管账号登录</p>

        <!-- 账号密码提醒小字 -->
        <div class="executive-login__mock">
          <p>温馨提示：主管端测试账号：</p>
          <p>• 用户名：executive</p>
          <p>• 密&nbsp;&nbsp;&nbsp;码：Train2026!</p>
        </div>
      </div>

      <n-form ref="formRef" :model="form" :rules="rules" size="large" class="executive-login__form">
        <n-form-item path="username">
          <n-input
            v-model:value="form.username"
            type="text"
            autocomplete="username"
            placeholder="请输入用户名"
            :disabled="loading"
          />
        </n-form-item>
        <n-form-item path="password">
          <n-input
            v-model:value="form.password"
            type="password"
            show-password-on="click"
            autocomplete="current-password"
            placeholder="请输入密码"
            :disabled="loading"
            @keyup.enter="handleSubmit"
          />
        </n-form-item>
        <n-button
          type="primary"
          block
          :loading="loading"
          class="executive-login__btn"
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
  import { HQ_ENTRY_KEY } from '@/constants/entry';
  import { websiteConfig } from '@/config/website.config';

  const formRef = ref();
  const loading = ref(false);
  const message = useMessage();
  const userStore = useUserStore();
  const router = useRouter();
  const route = useRoute();

  const form = reactive({
    username: '',
    password: '',
  });

  const rules = {
    username: [
      {
        required: true,
        message: '请输入用户名',
        trigger: 'blur',
      },
    ],
    password: [
      {
        required: true,
        message: '请输入密码',
        trigger: 'blur',
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
        sessionStorage.removeItem(HQ_ENTRY_KEY);
        // 调用统一登录接口
        const { code, message: msg } = await userStore.login({
          username: form.username.trim(),
          password: form.password,
        });
        message.destroyAll();
        if (code !== ResultEnum.SUCCESS) {
          message.warning(msg || '用户名或密码错误，登录失败');
          return;
        }
        const role = userStore.getUserInfo?.role;
        if (role === 'executive') {
          const redirect = (route.query.redirect as string) || '/executive';
          router.replace(decodeURIComponent(redirect));
          return;
        }
        message.info('无权访问主管端，请使用相应权限账号登录');
        await userStore.logout();
      } finally {
        loading.value = false;
      }
    });
  };
</script>

<style lang="less" scoped>
  .executive-login {
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

  .executive-login__card {
    width: 100%;
    max-width: 400px;
    margin-top: 8vh;
    padding: 28px 22px 32px;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.92);
    box-shadow: 0 12px 40px rgba(30, 60, 90, 0.12);
  }

  .executive-login__brand {
    text-align: center;
    margin-bottom: 28px;
  }

  .executive-login__logo {
    width: 56px;
    height: 56px;
    object-fit: contain;
    margin-bottom: 12px;
  }

  .executive-login__title {
    margin: 0 0 8px;
    font-size: 22px;
    font-weight: 600;
    color: #1a2b3c;
  }

  .executive-login__sub {
    margin: 0 0 16px;
    font-size: 13px;
    color: #64748b;
    line-height: 1.5;
  }

  .executive-login__mock {
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

  .executive-login__form {
    :deep(.n-form-item) {
      margin-bottom: 15px;
    }
  }

  .executive-login__btn {
    margin-top: 8px;
    height: 46px;
    font-size: 16px;
    border-radius: 10px;
  }
</style>
