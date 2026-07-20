# Roteiro de validação V4

Use a URL `/v4/` no computador e no celular com a mesma conta.

## Dados e sincronização

- [ ] A migração baixa um backup e o relatório preserva as contagens da V3.
- [ ] Um pedido criado no PC aparece automaticamente no celular.
- [ ] Uma alteração feita no celular aparece automaticamente no PC.
- [ ] Offline mostra `Offline` ou `Pendente`; ao reconectar, muda para `Sincronizado`.
- [ ] Trocar de conta não mostra nem envia dados da conta anterior.

## Pedido, prazo e pagamento

- [ ] Calcular e salvar cria o mesmo pedido em Controle e Prazos.
- [ ] Alterar o formulário desabilita Salvar até um novo cálculo.
- [ ] Editar um pedido pendente atualiza todas as abas.
- [ ] Comercial, produção e pagamento mudam de forma independente.
- [ ] Entregar não marca como pago e pagar não muda a produção.
- [ ] Arquivar oculta sem apagar; restaurar recupera o registro.

## Estoque

- [ ] Salvar orçamento não altera o saldo.
- [ ] Iniciar produção baixa a soma correta por filamento uma única vez.
- [ ] Dois itens no mesmo rolo não deixam saldo negativo.
- [ ] Repetir o clique ou agir em dois aparelhos não duplica a baixa.
- [ ] Cancelar devolve uma única vez; pedido entregue recusa cancelamento.

## PDF e celular

- [ ] PDF abre no PC e no celular a partir de um pedido salvo.
- [ ] O documento contém fotos, descrição, observações e chave PIX, sem QR Code.
- [ ] Navegação, tabelas, formulários e diálogos funcionam em tela estreita.
- [ ] A aplicação pode ser adicionada à tela inicial e reabre com o cache local.
