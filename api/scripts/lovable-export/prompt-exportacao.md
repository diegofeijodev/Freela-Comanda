Vamos copiar os dados deste sistema para um servidor próprio. Não mexa em telas, tabelas, dados, políticas nem em nada que já existe.

Crie uma migration com EXATAMENTE o SQL abaixo, sem alterar nada, e aplique. Ela cria uma função temporária com estas garantias:
- só um ADMINISTRADOR logado consegue chamar (usa a mesma checagem `public.is_admin()` das políticas; visitante sem login e perfil loja recebem "Acesso negado");
- NÃO exporta senha nem hash de senha: das contas, só id, e-mail, data de criação, dia do último acesso e situação;
- é só leitura (STABLE): não grava, não altera e não apaga nada;
- é temporária: vamos apagá-la logo depois da mudança.

Não precisa criar tela, rota nem publicar o app — só o banco muda.

__SQL__
